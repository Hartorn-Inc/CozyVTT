/**
 * Removing someone from a campaign reaching a connection that is already open.
 *
 * Kick tells the socket `campaign.access.revoked` `{ reason: 'removed' }` and
 * disconnects it (ADR 0007). Discrete writes also re-read membership at
 * commit. The login session remains: a later handshake with the same cookie
 * is accepted; `authenticate` to the campaign they were removed from is then
 * refused. Another campaign's socket is left alone.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { clearCampaignFromLiveSockets } from '../utils';
import {
  createWsTestServer,
  waitForEvent,
  expectNoEvent,
  WsTestServer,
} from '../../__tests__/helpers/websocket-test-server';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);
const email = (name: string) => `revoked-${name}-${runId}@test.cozyvtt.local`;

let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let otherCampaignId: string;
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

/** Try to speak in the campaign; resolve with what came back. */
function attemptChat(client: ClientSocket, content: string): Promise<'sent' | 'refused'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('neither outcome within 5s')), 5000);
    const done = (outcome: 'sent' | 'refused') => {
      clearTimeout(timer);
      client.off('chat.message', onSent);
      client.off('error', onError);
      resolve(outcome);
    };
    const onSent = () => done('sent');
    const onError = () => done('refused');
    client.once('chat.message', onSent);
    client.once('error', onError);
    client.emit('chat.message', { content, type: 'PLAYER' });
  });
}

beforeAll(async () => {
  const [dm, player] = await Promise.all(
    ['dm', 'player'].map((name) =>
      prisma.user.create({
        data: {
          email: email(name),
          passwordHash: 'not-used-by-socket-auth',
          displayName: `Revoked ${name}`,
        },
      })
    )
  );
  dmId = dm.id;
  playerId = player.id;

  const [campaign, other] = await Promise.all([
    prisma.campaign.create({ data: { name: `Revoked Campaign ${runId}`, ownerId: dmId, vibeSettings: {} } }),
    prisma.campaign.create({ data: { name: `Other Campaign ${runId}`, ownerId: playerId, vibeSettings: {} } }),
  ]);
  campaignId = campaign.id;
  otherCampaignId = other.id;

  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
      { userId: playerId, campaignId: otherCampaignId, role: 'DM', characterIds: [] },
    ],
  });

  server = await createWsTestServer();
  [dmCookie, playerCookie] = await Promise.all([server.loginAs(dmId), server.loginAs(playerId)]);
});

afterAll(async () => {
  await server?.close();
  await prisma.campaign.deleteMany({ where: { id: { in: [campaignId, otherCampaignId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [dmId, playerId] } } });
  await prisma.$disconnect();
});

describe('clearCampaignFromLiveSockets', () => {
  it('tells the connection why, then disconnects it', async () => {
    const playerClient = await server.connectAndAuth(playerCookie, campaignId);

    const told = waitForEvent<{ campaignId: string | null; reason: string; message: string }>(
      playerClient,
      'campaign.access.revoked'
    );
    const dropped = waitDisconnect(playerClient);
    await clearCampaignFromLiveSockets(playerId, campaignId);

    await expect(told).resolves.toEqual({
      campaignId,
      reason: 'removed',
      message: 'You were removed from this campaign.',
    });
    await expect(dropped).resolves.toBe('io server disconnect');
  });

  it('stops it hearing what the table says', async () => {
    const playerClient = await server.connectAndAuth(playerCookie, campaignId);
    const dmClient = await server.connectAndAuth(dmCookie, campaignId);

    const heard = waitForEvent(playerClient, 'chat.message');
    dmClient.emit('chat.message', { content: 'before removal', type: 'DM' });
    await expect(heard).resolves.toBeDefined();

    const dropped = waitDisconnect(playerClient);
    await clearCampaignFromLiveSockets(playerId, campaignId);
    await dropped;

    const silence = expectNoEvent(playerClient, 'chat.message', 500);
    dmClient.emit('chat.message', { content: 'after removal', type: 'DM' });
    await expect(silence).resolves.toBeUndefined();

    dmClient.disconnect();
  });

  it('leaves a connection to another campaign alone', async () => {
    const elsewhere = await server.connectAndAuth(playerCookie, otherCampaignId);

    expect(await attemptChat(elsewhere, 'in my own game')).toBe('sent');

    await clearCampaignFromLiveSockets(playerId, campaignId);

    expect(await attemptChat(elsewhere, 'still in my own game')).toBe('sent');
    expect(elsewhere.connected).toBe(true);

    elsewhere.disconnect();
  });

  it('does not tell another campaign, and does not revoke the login session', async () => {
    const playerClient = await server.connectAndAuth(playerCookie, campaignId);
    const elsewhere = await server.connectAndAuth(playerCookie, otherCampaignId);

    const told = waitForEvent<{ campaignId: string | null; reason: string }>(playerClient, 'campaign.access.revoked');
    const notTold = expectNoEvent(elsewhere, 'campaign.access.revoked', 500);
    const dropped = waitDisconnect(playerClient);
    await clearCampaignFromLiveSockets(playerId, campaignId);

    await expect(told).resolves.toMatchObject({ campaignId, reason: 'removed' });
    await expect(notTold).resolves.toBeUndefined();
    await dropped;

    const again = await server.connectClient(playerCookie);
    expect(again.connected).toBe(true);
    again.disconnect();
    elsewhere.disconnect();
  });

  it('refuses authenticate to the campaign after membership is gone, while the cookie still connects', async () => {
    const playerClient = await server.connectAndAuth(playerCookie, campaignId);
    await prisma.campaignMembership.delete({
      where: { userId_campaignId: { userId: playerId, campaignId } },
    });
    const dropped = waitDisconnect(playerClient);
    await clearCampaignFromLiveSockets(playerId, campaignId);
    await dropped;

    const again = await server.connectClient(playerCookie);
    const refusal = waitForEvent<{ message: string }>(again, 'error');
    again.emit('authenticate', { campaignId });
    expect((await refusal).message).toMatch(/not a member/i);
    expect(again.connected).toBe(true);

    await prisma.campaignMembership.create({
      data: { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
    });
    again.disconnect();
  });

  it('is a quiet no-op when the user has no connection open', async () => {
    const neverConnected = randomUUID();
    expect(await clearCampaignFromLiveSockets(neverConnected, campaignId)).toBe(0);
  });
});
