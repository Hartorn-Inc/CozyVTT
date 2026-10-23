/**
 * Token-drag authorization: 2 s stale bound, then a monitor disconnects (ADR 0007).
 *
 * `token.move` frames may reuse a successful confirm for `DRAG_AUTH_STALE_MS`.
 * After that, the per-socket monitor reconfirms; a removed member is kicked
 * (`campaign.access.revoked` `removed`) and disconnected so they cannot drag
 * forever on cached `socket.role`. A demotion to spectator disconnects
 * without that event so a client can reconnect with the new role. An open
 * drag is put back at the stored square (`token.moved` with `movedBy` null),
 * since kick and demotion never reach `token.move.end`.
 *
 * Requires PostgreSQL at DATABASE_URL. One test waits the 2 s bound.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { DRAG_AUTH_STALE_MS } from '../writeAuthz';
import {
  createWsTestServer,
  expectNoEvent,
  waitForEvent,
  WsTestServer,
} from '../../__tests__/helpers/websocket-test-server';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);
const email = (name: string) => `dragauthz-${name}-${runId}@test.cozyvtt.local`;

let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let mapId: string;
let dmCookie: string;
let playerCookie: string;

const OWN = 'token-own';

function token(id: string, x: number, controlledBy: string | null) {
  return {
    id, name: id, imageUrl: '/api/assets/tokens/none',
    position: { x, y: 5 }, size: { width: 1, height: 1 },
    layer: 'token', visible: true, controlledBy, rotation: 0, conditions: [], metadata: {},
  };
}

function waitDisconnect(client: ClientSocket, timeoutMs = DRAG_AUTH_STALE_MS + 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!client.connected) {
      resolve('already');
      return;
    }
    const timer = setTimeout(
      () => reject(new Error(`disconnect not received within ${timeoutMs}ms`)),
      timeoutMs
    );
    client.once('disconnect', (reason: string) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

beforeAll(async () => {
  const [dm, player] = await Promise.all(
    ['dm', 'player'].map((name) =>
      prisma.user.create({
        data: { email: email(name), passwordHash: 'not-used-by-socket-auth', displayName: `Dragauthz ${name}` },
      })
    )
  );
  dmId = dm.id;
  playerId = player.id;
  const campaign = await prisma.campaign.create({
    data: { name: `Drag authz ${runId}`, ownerId: dmId, vibeSettings: {} },
  });
  campaignId = campaign.id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });
  const map = await prisma.map.create({
    data: {
      campaignId, name: 'Drag authz map', imageUrl: '/api/assets/maps/none', baseLayerUrl: '/api/assets/maps/none',
      width: 20, height: 20, tokens: [token(OWN, 5, playerId)], annotations: [], lightingEnabled: false,
    },
  });
  mapId = map.id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId } });
  server = await createWsTestServer();
  [dmCookie, playerCookie] = await Promise.all([server.loginAs(dmId), server.loginAs(playerId)]);
});

afterAll(async () => {
  await server?.close();
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await prisma.map.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: { in: [dmId, playerId] } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.map.update({
    where: { id: mapId },
    data: { tokens: [token(OWN, 5, playerId)] },
  });
  await prisma.campaignMembership.upsert({
    where: { userId_campaignId: { userId: playerId, campaignId } },
    create: { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
    update: { role: 'PLAYER' },
  });
});

describe('token-drag authorization after DRAG_AUTH_STALE_MS (ADR 0007)', () => {
  it('disconnects a removed member via the monitor, with campaign.access.revoked removed', async () => {
    const player = await server.connectAndAuth(playerCookie, campaignId);
    const dm = await server.connectAndAuth(dmCookie, campaignId);

    const frame = waitForEvent<{ tokenId: string; dragging?: boolean }>(dm, 'token.moved');
    player.emit('token.move.start', { tokenId: OWN, mapId });
    player.emit('token.move', { tokenId: OWN, mapId, x: 6, y: 5 });
    expect(await frame).toMatchObject({ tokenId: OWN, dragging: true });

    const home = waitForEvent<{ tokenId: string; x: number; y: number; dragging?: boolean; movedBy: string | null }>(
      dm, 'token.moved', DRAG_AUTH_STALE_MS + 3000
    );

    await prisma.campaignMembership.delete({
      where: { userId_campaignId: { userId: playerId, campaignId } },
    });

    const revoked = waitForEvent<{ reason: string }>(player, 'campaign.access.revoked', DRAG_AUTH_STALE_MS + 3000);
    const dropped = waitDisconnect(player);
    await expect(revoked).resolves.toMatchObject({ reason: 'removed' });
    await expect(dropped).resolves.toBe('io server disconnect');
    expect(await home).toEqual({ tokenId: OWN, mapId, x: 5, y: 5, movedBy: null });

    const quiet = expectNoEvent(dm, 'token.moved', 400);
    // The socket is already gone; a further frame must not reach the table.
    player.emit('token.move', { tokenId: OWN, mapId, x: 7, y: 5 });
    await quiet;

    dm.disconnect();
  });

  it('disconnects a spectator demotion via the monitor without campaign.access.revoked', async () => {
    const player = await server.connectAndAuth(playerCookie, campaignId);
    const dm = await server.connectAndAuth(dmCookie, campaignId);

    const frame = waitForEvent<{ tokenId: string }>(dm, 'token.moved');
    player.emit('token.move.start', { tokenId: OWN, mapId });
    player.emit('token.move', { tokenId: OWN, mapId, x: 6, y: 5 });
    expect((await frame).tokenId).toBe(OWN);

    const home = waitForEvent<{ tokenId: string; x: number; y: number; dragging?: boolean; movedBy: string | null }>(
      dm, 'token.moved', DRAG_AUTH_STALE_MS + 3000
    );

    await prisma.campaignMembership.update({
      where: { userId_campaignId: { userId: playerId, campaignId } },
      data: { role: 'SPECTATOR' },
    });

    const revoked: unknown[] = [];
    player.on('campaign.access.revoked', (payload: unknown) => revoked.push(payload));
    const dropped = waitDisconnect(player);
    await expect(dropped).resolves.toBe('io server disconnect');
    expect(revoked).toEqual([]);
    expect(await home).toEqual({ tokenId: OWN, mapId, x: 5, y: 5, movedBy: null });

    dm.disconnect();
  });
});
