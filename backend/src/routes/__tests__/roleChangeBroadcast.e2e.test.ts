/**
 * A role change reaches the table and drops that member's campaign sockets.
 *
 * ADR 0007: a role change disconnects those campaign sockets without
 * `campaign.access.revoked` so the client reconnects and authenticates with
 * the new role. The login session remains. HTTP still broadcasts
 * `campaign.role.changed` / `campaign.dm.transferred` to whoever is still in
 * the room (other members). The affected member's old socket is already gone.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, createTestCampaign, cleanupCampaigns, cleanupUsers, TEST_PASSWORD } from '../../__tests__/helpers/db';
import { createWsTestServer, waitForEvent, expectNoEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { toJson } from '../../utils/prisma-json';

jest.setTimeout(30000);

const app = createTestApp();
let server: WsTestServer;
let dmId: string;
let playerId: string;
let watcherId: string;
let campaignId: string;
let dm: ReturnType<typeof request.agent>;

function waitDisconnect(client: ClientSocket): Promise<string> {
  return new Promise((resolve) => {
    if (!client.connected) {
      resolve('already');
      return;
    }
    client.once('disconnect', (reason: string) => resolve(reason));
  });
}

beforeAll(async () => {
  const stamp = randomUUID().slice(0, 8);
  const dmUser = await createTestUser({ email: `rolechg-dm-${stamp}@test.cozyvtt.local`, displayName: 'DM' });
  const playerUser = await createTestUser({ email: `rolechg-p-${stamp}@test.cozyvtt.local`, displayName: 'Player' });
  const watcherUser = await createTestUser({ email: `rolechg-w-${stamp}@test.cozyvtt.local`, displayName: 'Watcher' });
  dmId = dmUser.id;
  playerId = playerUser.id;
  watcherId = watcherUser.id;
  campaignId = (await createTestCampaign(dmId, { name: `Role change ${stamp}` })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
      { userId: watcherId, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });
  dm = request.agent(app);
  expect((await dm.post('/api/auth/login').send({ email: dmUser.email, password: TEST_PASSWORD })).status).toBe(200);
  server = await createWsTestServer();
});

afterAll(async () => {
  await server.close();
  await cleanupCampaigns([campaignId]);
  await cleanupUsers([dmId, playerId, watcherId]);
  await prisma.$disconnect();
});

it("disconnects the member's campaign socket without campaign.access.revoked; others hear campaign.role.changed; the cookie reconnects as the new role", async () => {
  const memberCookie = await server.loginAs(playerId);
  const member = await server.connectAndAuth(memberCookie, campaignId);
  const table = await server.connectAndAuth(await server.loginAs(dmId), campaignId);
  const toTable = waitForEvent<{ userId: string; role: string }>(table, 'campaign.role.changed');
  const notRevoked = expectNoEvent(member, 'campaign.access.revoked', 500);
  const dropped = waitDisconnect(member);

  const res = await dm.put(`/api/campaigns/${campaignId}/members/${playerId}/role`).send({ role: 'SPECTATOR' });
  expect(res.status).toBe(200);

  await expect(dropped).resolves.toBe('io server disconnect');
  await expect(notRevoked).resolves.toBeUndefined();
  expect(await toTable).toMatchObject({ userId: playerId, role: 'SPECTATOR' });

  const again = await server.connectAndAuth(memberCookie, campaignId);
  expect(again.connected).toBe(true);
  again.disconnect();
  table.disconnect();
});

const litMapWith = async (tokens: Record<string, unknown>[]) => {
  const mapId = (await prisma.map.create({
    data: {
      campaignId, name: 'Shown', imageUrl: '/api/assets/maps/x', baseLayerUrl: '/api/assets/maps/x',
      width: 10, height: 10, gridSize: 50, annotations: [], lightingEnabled: true, globalIllumination: true, tokens: toJson(tokens),
    },
  })).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId } });
  return mapId;
};
const mapToken = (id: string, controlledBy: string | null, changes: Record<string, unknown> = {}) => ({
  id, name: id, imageUrl: '', position: { x: 1, y: 1 }, size: { width: 1, height: 1 }, layer: 'token', visible: true,
  controlledBy, rotation: 0, conditions: [], metadata: {}, ...changes,
});
type Resent = { mapId: string; mapData: { tokens: { id: string; notes?: string }[] } };

it("re-sends the map to whoever is still in the room, as each remaining role sees it", async () => {
  const mapId = await litMapWith([mapToken('theirs', playerId)]);
  await prisma.campaignMembership.update({ where: { userId_campaignId: { userId: playerId, campaignId } }, data: { role: 'SPECTATOR' } });
  try {
    const memberCookie = await server.loginAs(playerId);
    const member = await server.connectAndAuth(memberCookie, campaignId);
    const table = await server.connectAndAuth(await server.loginAs(dmId), campaignId);
    const tableMap = waitForEvent<Resent>(table, 'map.changed');
    const dropped = waitDisconnect(member);
    expect((await dm.put(`/api/campaigns/${campaignId}/members/${playerId}/role`).send({ role: 'PLAYER' })).status).toBe(200);
    await dropped;
    const asDmView = await tableMap;
    expect(asDmView.mapId).toBe(mapId);
    expect(asDmView.mapData.tokens.map((t) => t.id)).toContain('theirs');

    const again = await server.connectAndAuth(memberCookie, campaignId);
    expect(again.connected).toBe(true);
    again.disconnect();
    table.disconnect();
  } finally {
    await prisma.campaignMembership.update({ where: { userId_campaignId: { userId: playerId, campaignId } }, data: { role: 'PLAYER' } });
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
    await prisma.map.deleteMany({ where: { id: mapId } });
  }
});

it('drops both sides of a DM handover; a watcher still hears the transfer and roster regroup', async () => {
  const mapId = await litMapWith([mapToken('theirs', playerId), mapToken('lurker', null, { visible: false, notes: 'ambush' })]);
  try {
    await prisma.campaignMembership.update({ where: { userId_campaignId: { userId: playerId, campaignId } }, data: { role: 'PLAYER' } });
    await prisma.campaignMembership.update({ where: { userId_campaignId: { userId: dmId, campaignId } }, data: { role: 'DM' } });
    const incomingCookie = await server.loginAs(playerId);
    const outgoingCookie = await server.loginAs(dmId);
    const incoming = await server.connectAndAuth(incomingCookie, campaignId);
    const outgoing = await server.connectAndAuth(outgoingCookie, campaignId);
    const watcher = await server.connectAndAuth(await server.loginAs(watcherId), campaignId);
    const transferred = waitForEvent<{ newDmId: string }>(watcher, 'campaign.dm.transferred');
    const regrouped = new Promise<string[]>((resolve) => {
      const ids: string[] = [];
      watcher.on('roster.updated', (e: { userId: string; action: string }) => {
        if (e.action === 'member.role') ids.push(e.userId);
        if (ids.length === 2) resolve(ids);
      });
    });
    const incomingDropped = waitDisconnect(incoming);
    const outgoingDropped = waitDisconnect(outgoing);

    expect((await dm.put(`/api/campaigns/${campaignId}/dm`).send({ userId: playerId })).status).toBe(200);

    await expect(incomingDropped).resolves.toBe('io server disconnect');
    await expect(outgoingDropped).resolves.toBe('io server disconnect');
    expect((await transferred).newDmId).toBe(playerId);
    expect((await regrouped).sort()).toEqual([dmId, playerId].sort());

    const incomingAgain = await server.connectAndAuth(incomingCookie, campaignId);
    const outgoingAgain = await server.connectAndAuth(outgoingCookie, campaignId);
    expect(incomingAgain.connected).toBe(true);
    expect(outgoingAgain.connected).toBe(true);
    incomingAgain.disconnect();
    outgoingAgain.disconnect();
    watcher.disconnect();
  } finally {
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
    await prisma.map.deleteMany({ where: { id: mapId } });
  }
});
