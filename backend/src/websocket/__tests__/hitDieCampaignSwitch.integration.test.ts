/**
 * Spending a hit die must not fan the sheet out to a campaign the socket
 * authenticated into after the locked membership check.
 *
 * `character.hitdice.spend` captures campaign A, then awaits authorization.
 * After the transaction it used live `socket.campaignId`, so a same-socket
 * authenticate into B sent A's sheet (Keeper's Notes included for a DM)
 * into B's room.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { toJson } from '../../utils/prisma-json';
import {
  createWsTestServer,
  expectNoEvent,
  waitForEvent,
  WsTestServer,
} from '../../__tests__/helpers/websocket-test-server';
import * as writeAuthz from '../writeAuthz';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);
const email = (name: string) => `hitdie-switch-${name}-${runId}@test.cozyvtt.local`;

let server: WsTestServer;
let hostId: string;
let switcherId: string;
let campaignA: string;
let campaignB: string;
let characterId: string;
let hostCookie: string;
let switcherCookie: string;

type Sheet = {
  hp: { current: number; maximum: number; temporary: number };
  hitDice: Array<{ class: string; die: string; maximum: number; remaining: number }>;
};
const sheet = (): Sheet => ({
  hp: { current: 10, maximum: 12, temporary: 0 },
  hitDice: [{ class: 'fighter', die: 'd10', maximum: 3, remaining: 3 }],
});

async function reauth(client: ClientSocket, campaignId: string): Promise<void> {
  const done = waitForEvent<{ campaignId: string }>(client, 'authenticated');
  client.emit('authenticate', { campaignId });
  expect((await done).campaignId).toBe(campaignId);
}

beforeAll(async () => {
  const [host, switcher] = await Promise.all(
    ['host', 'switcher'].map((name) =>
      prisma.user.create({
        data: {
          email: email(name),
          passwordHash: 'not-used-by-socket-auth',
          displayName: `Hitdie switch ${name}`,
        },
      })
    )
  );
  hostId = host.id;
  switcherId = switcher.id;

  const [a, b] = await Promise.all([
    prisma.campaign.create({ data: { name: `Hitdie A ${runId}`, ownerId: hostId, vibeSettings: {}, gameSystem: 'DND_5E' } }),
    prisma.campaign.create({ data: { name: `Hitdie B ${runId}`, ownerId: switcherId, vibeSettings: {} } }),
  ]);
  campaignA = a.id;
  campaignB = b.id;

  const character = await prisma.character.create({
    data: { userId: switcherId, campaignId: campaignA, name: 'Aldra', gameSystem: 'DND_5E', data: toJson(sheet()) },
  });
  characterId = character.id;

  await prisma.campaignMembership.createMany({
    data: [
      { userId: hostId, campaignId: campaignA, role: 'DM', characterIds: [] },
      { userId: switcherId, campaignId: campaignA, role: 'PLAYER', characterIds: [characterId] },
      { userId: switcherId, campaignId: campaignB, role: 'DM', characterIds: [] },
    ],
  });

  server = await createWsTestServer();
  [hostCookie, switcherCookie] = await Promise.all([server.loginAs(hostId), server.loginAs(switcherId)]);
});

afterAll(async () => {
  await server?.close();
  await prisma.character.deleteMany({ where: { id: characterId } });
  await prisma.campaign.deleteMany({ where: { id: { in: [campaignA, campaignB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [hostId, switcherId] } } });
  await prisma.$disconnect();
});

describe('character.hitdice.spend while authenticate moves the socket into B', () => {
  it('does not send character.updated into B after the spender authenticates there', async () => {
    const host = await server.connectAndAuth(hostCookie, campaignA);
    const spender = await server.connectAndAuth(switcherCookie, campaignA);
    const observer = await server.connectAndAuth(switcherCookie, campaignB);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => { reached = resolve; });
    const original = writeAuthz.confirmWriteAuthorization.bind(writeAuthz);
    const spy = jest.spyOn(writeAuthz, 'confirmWriteAuthorization').mockImplementation(async (socket, options) => {
      const result = await original(socket, options);
      if (options?.db) {
        reached();
        await gate;
      }
      return result;
    });

    try {
      spender.emit('character.hitdice.spend', { characterId, index: 0 });
      await waiting;
      await reauth(spender, campaignB);
      const quietOnB = expectNoEvent(observer, 'character.updated', 800);
      const onA = waitForEvent(host, 'character.updated');
      release();
      await onA;
      await expect(quietOnB).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
      host.disconnect();
      spender.disconnect();
      observer.disconnect();
    }
  });
});
