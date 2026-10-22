/**
 * A role change dropping that campaign's sockets (ADR 0007).
 *
 * `socket.role` is set when the socket authenticates; handlers never take a
 * role off the wire. Updating it in place left a demoted DM with DM powers
 * until they reloaded. A role change now disconnects those campaign sockets
 * without `campaign.access.revoked` (they are still a member), leaves the
 * login session, and a reconnecting client authenticates with the new role.
 * Another campaign's socket is left alone.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { applyRoleToLiveSockets, broadcastToCampaign } from '../utils';
import {
  createWsTestServer,
  waitForEvent,
  expectNoEvent,
  WsTestServer,
} from '../../__tests__/helpers/websocket-test-server';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);
const email = (name: string) => `liverole-${name}-${runId}@test.cozyvtt.local`;

let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let dmCookie: string;
let playerCookie: string;

function waitDisconnect(client: ClientSocket): Promise<string> {
  return new Promise((resolve) => {
    if (!client.connected) {
      resolve('already');
      return;
    }
    client.once('disconnect', (reason: string) => resolve(reason));
  });
}

/** Ask a socket to clear roll history; resolve with what came back. */
function attemptClear(client: ClientSocket): Promise<'allowed' | 'refused'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('neither outcome within 5s')), 5000);
    const done = (outcome: 'allowed' | 'refused') => {
      clearTimeout(timer);
      client.off('dice.historyCleared', onCleared);
      client.off('error', onError);
      resolve(outcome);
    };
    const onCleared = () => done('allowed');
    const onError = () => done('refused');
    client.once('dice.historyCleared', onCleared);
    client.once('error', onError);
    client.emit('dice.clearHistory');
  });
}

beforeAll(async () => {
  const [dm, player] = await Promise.all(
    ['dm', 'player'].map((name) =>
      prisma.user.create({
        data: {
          email: email(name),
          passwordHash: 'not-used-by-socket-auth',
          displayName: `Liverole ${name}`,
        },
      })
    )
  );
  dmId = dm.id;
  playerId = player.id;

  const campaign = await prisma.campaign.create({
    data: { name: `Live Role Campaign ${runId}`, ownerId: dmId, vibeSettings: {} },
  });
  campaignId = campaign.id;

  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });

  server = await createWsTestServer();
  [dmCookie, playerCookie] = await Promise.all([
    server.loginAs(dmId),
    server.loginAs(playerId),
  ]);
});

afterAll(async () => {
  await server?.close();
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: { in: [dmId, playerId] } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { rollHistoryClearedAt: null },
  });
  await prisma.campaignMembership.update({
    where: { userId_campaignId: { userId: dmId, campaignId } },
    data: { role: 'DM' },
  });
  await prisma.campaignMembership.update({
    where: { userId_campaignId: { userId: playerId, campaignId } },
    data: { role: 'PLAYER' },
  });
});

describe('applyRoleToLiveSockets', () => {
  it('drops a demoted DM\'s campaign socket without campaign.access.revoked; a reconnect authenticates as PLAYER', async () => {
    const dmClient = await server.connectAndAuth(dmCookie, campaignId);
    expect(await attemptClear(dmClient)).toBe('allowed');

    await prisma.campaignMembership.update({
      where: { userId_campaignId: { userId: dmId, campaignId } },
      data: { role: 'PLAYER' },
    });

    const notRevoked = expectNoEvent(dmClient, 'campaign.access.revoked', 500);
    const dropped = waitDisconnect(dmClient);
    expect(await applyRoleToLiveSockets(dmId, campaignId, 'PLAYER')).toBe(1);
    await expect(dropped).resolves.toBe('io server disconnect');
    await expect(notRevoked).resolves.toBeUndefined();

    const again = await server.connectAndAuth(dmCookie, campaignId);
    expect(await attemptClear(again)).toBe('refused');
    again.disconnect();
  });

  it('drops a promoted player\'s campaign socket; a reconnect authenticates as DM', async () => {
    const playerClient = await server.connectAndAuth(playerCookie, campaignId);
    expect(await attemptClear(playerClient)).toBe('refused');

    await prisma.campaignMembership.update({
      where: { userId_campaignId: { userId: playerId, campaignId } },
      data: { role: 'DM' },
    });

    const notRevoked = expectNoEvent(playerClient, 'campaign.access.revoked', 500);
    const dropped = waitDisconnect(playerClient);
    expect(await applyRoleToLiveSockets(playerId, campaignId, 'DM')).toBe(1);
    await expect(dropped).resolves.toBe('io server disconnect');
    await expect(notRevoked).resolves.toBeUndefined();

    const again = await server.connectAndAuth(playerCookie, campaignId);
    expect(await attemptClear(again)).toBe('allowed');
    again.disconnect();
  });

  it('touches nothing when the user has no connection open', async () => {
    const neverConnected = randomUUID();
    expect(await applyRoleToLiveSockets(neverConnected, campaignId, 'DM')).toBe(0);
  });

  it('leaves the same user alone on a campaign they are not being changed in', async () => {
    const otherCampaign = await prisma.campaign.create({
      data: { name: `Other ${runId}`, ownerId: dmId, vibeSettings: {} },
    });
    await prisma.campaignMembership.create({
      data: { userId: dmId, campaignId: otherCampaign.id, role: 'DM', characterIds: [] },
    });

    const elsewhere = await server.connectAndAuth(dmCookie, otherCampaign.id);
    expect(await attemptClear(elsewhere)).toBe('allowed');

    await prisma.campaignMembership.update({
      where: { userId_campaignId: { userId: dmId, campaignId } },
      data: { role: 'PLAYER' },
    });
    await applyRoleToLiveSockets(dmId, campaignId, 'PLAYER');
    expect(elsewhere.connected).toBe(true);
    expect(await attemptClear(elsewhere)).toBe('allowed');

    elsewhere.disconnect();
    await prisma.campaign.deleteMany({ where: { id: otherCampaign.id } });
  });
});

describe('campaign.dm.transferred', () => {
  it('reaches everyone in the campaign so open clients can re-derive their role', async () => {
    const dmClient = await server.connectAndAuth(dmCookie, campaignId);
    const playerClient = await server.connectAndAuth(playerCookie, campaignId);

    const heard = Promise.all([
      waitForEvent<{ newDmId: string; previousDmId: string | null }>(
        dmClient,
        'campaign.dm.transferred'
      ),
      waitForEvent<{ newDmId: string }>(playerClient, 'campaign.dm.transferred'),
    ]);

    broadcastToCampaign(campaignId, 'campaign.dm.transferred', {
      campaignId,
      previousDmId: dmId,
      newDmId: playerId,
    });

    const [onDm, onPlayer] = await heard;
    expect(onDm.newDmId).toBe(playerId);
    expect(onDm.previousDmId).toBe(dmId);
    expect(onPlayer.newDmId).toBe(playerId);

    dmClient.disconnect();
    playerClient.disconnect();
  });
});
