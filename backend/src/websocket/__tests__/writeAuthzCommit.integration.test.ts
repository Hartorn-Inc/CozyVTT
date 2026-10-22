/**
 * Discrete socket writes recheck membership at commit (ADR 0007).
 *
 * A socket authenticates as DM and caches that role. Changing the membership
 * row to PLAYER or SPECTATOR without dropping the socket used to leave DM
 * writes succeeding on the cached role. Commit-time recheck refuses them and
 * does not persist.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Store } from 'express-session';
import { prisma } from '../../config/database';
import { createWsTestServer, waitForEvent, expectNoEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { toJson, readTokens } from '../../utils/prisma-json';
import { LOGIN_SESSION_UNCONFIRMED_MESSAGE } from '../writeAuthz';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);
const email = (name: string) => `writeauthz-${name}-${runId}@test.cozyvtt.local`;

let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let characterId: string;
let dmCookie: string;

type Sheet = { hp: { current: number; maximum: number; temporary: number } };
const sheet = (): Sheet => ({ hp: { current: 10, maximum: 12, temporary: 0 } });
const storedHp = async (): Promise<number> =>
  ((await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).data as Sheet).hp.current;

beforeAll(async () => {
  const [dm, player] = await Promise.all(
    ['dm', 'player'].map((name) =>
      prisma.user.create({
        data: {
          email: email(name),
          passwordHash: 'not-used-by-socket-auth',
          displayName: `Writeauthz ${name}`,
        },
      })
    )
  );
  dmId = dm.id;
  playerId = player.id;
  const campaign = await prisma.campaign.create({
    data: { name: `Writeauthz ${runId}`, ownerId: dmId, vibeSettings: {} },
  });
  campaignId = campaign.id;
  const character = await prisma.character.create({
    data: { userId: playerId, campaignId, name: 'Aldra', gameSystem: 'DND_5E', data: toJson(sheet()) },
  });
  characterId = character.id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [characterId] },
    ],
  });
  server = await createWsTestServer();
  dmCookie = await server.loginAs(dmId);
});

beforeEach(async () => {
  await prisma.campaign.update({ where: { id: campaignId }, data: { rollHistoryClearedAt: null } });
  await prisma.character.update({ where: { id: characterId }, data: { data: toJson(sheet()) } });
  await prisma.campaignMembership.update({
    where: { userId_campaignId: { userId: dmId, campaignId } },
    data: { role: 'DM' },
  });
});

afterAll(async () => {
  await server?.close();
  await prisma.character.deleteMany({ where: { id: characterId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: { in: [dmId, playerId] } } });
  await prisma.$disconnect();
});

describe('commit-time authorization on an open DM socket (ADR 0007)', () => {
  it('refuses dice.clearHistory after the membership is set to PLAYER, and stores nothing', async () => {
    const dm = await server.connectAndAuth(dmCookie, campaignId);

    await prisma.campaignMembership.update({
      where: { userId_campaignId: { userId: dmId, campaignId } },
      data: { role: 'PLAYER' },
    });

    const denial = waitForEvent<{ message: string }>(dm, 'error');
    const silence = expectNoEvent(dm, 'dice.historyCleared');
    dm.emit('dice.clearHistory');
    expect((await denial).message).toMatch(/only the dm/i);
    await silence;

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { rollHistoryClearedAt: true },
    });
    expect(campaign.rollHistoryClearedAt).toBeNull();
    expect(dm.connected).toBe(true);

    dm.disconnect();
  });

  it('refuses character.hp.update on another sheet after demotion to SPECTATOR, and stores nothing', async () => {
    const dm = await server.connectAndAuth(dmCookie, campaignId);

    await prisma.campaignMembership.update({
      where: { userId_campaignId: { userId: dmId, campaignId } },
      data: { role: 'SPECTATOR' },
    });

    const denial = waitForEvent<{ message: string }>(dm, 'error');
    const silence = expectNoEvent(dm, 'character.hp.updated');
    dm.emit('character.hp.update', { characterId, delta: -4 });
    expect((await denial).message).toMatch(/spectator|permission/i);
    await silence;
    expect(await storedHp()).toBe(10);

    dm.disconnect();
  });

  it('refuses initiative.roll on an uncontrolled token after demotion to PLAYER, and stores nothing', async () => {
    const npc = `npc-${runId}`;
    const map = await prisma.map.create({
      data: {
        campaignId,
        name: `Writeauthz init ${runId}`,
        imageUrl: '/api/assets/maps/none',
        baseLayerUrl: '/api/assets/maps/none',
        width: 20,
        height: 20,
        annotations: [],
        tokens: [
          {
            id: npc,
            name: 'Goblin',
            imageUrl: '/api/assets/tokens/none',
            position: { x: 3, y: 3 },
            size: { width: 1, height: 1 },
            layer: 'token',
            visible: true,
            controlledBy: null,
            rotation: 0,
            conditions: [],
            metadata: {},
            initiative: null,
          },
        ],
      },
    });
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: map.id } });
    try {
      const dm = await server.connectAndAuth(dmCookie, campaignId);

      await prisma.campaignMembership.update({
        where: { userId_campaignId: { userId: dmId, campaignId } },
        data: { role: 'PLAYER' },
      });

      const denial = waitForEvent<{ message: string }>(dm, 'error');
      const silence = expectNoEvent(dm, 'initiative.state');
      dm.emit('initiative.roll', { tokenId: npc, mapId: map.id });
      expect((await denial).message).toMatch(/own token|spectator|permission/i);
      await silence;

      const stored = readTokens((await prisma.map.findUniqueOrThrow({ where: { id: map.id } })).tokens);
      expect(stored.find((t) => t.id === npc)?.initiative ?? null).toBeNull();
      expect(dm.connected).toBe(true);

      dm.disconnect();
    } finally {
      await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
      await prisma.map.deleteMany({ where: { id: map.id } });
    }
  });

  it('refuses a discrete write when the login session store cannot be confirmed, and stays connected', async () => {
    const dm = await server.connectAndAuth(dmCookie, campaignId);
    const serverSocket = [...server.io.sockets.sockets.values()][0];
    const store = (serverSocket?.request as { sessionStore?: Store } | undefined)?.sessionStore;
    expect(store).toBeDefined();
    const originalGet = store!.get.bind(store);
    store!.get = ((
      _sid: string,
      callback: (err: Error | null, session?: never) => void
    ) => {
      callback(new Error('store unavailable'));
    }) as Store['get'];

    try {
      const denial = waitForEvent<{ message: string }>(dm, 'error');
      const notRevoked = expectNoEvent(dm, 'campaign.access.revoked');
      const silence = expectNoEvent(dm, 'dice.historyCleared');
      dm.emit('dice.clearHistory');
      expect((await denial).message).toBe(LOGIN_SESSION_UNCONFIRMED_MESSAGE);
      await silence;
      await notRevoked;
      expect(dm.connected).toBe(true);

      const campaign = await prisma.campaign.findUniqueOrThrow({
        where: { id: campaignId },
        select: { rollHistoryClearedAt: true },
      });
      expect(campaign.rollHistoryClearedAt).toBeNull();
    } finally {
      store!.get = originalGet;
      dm.disconnect();
    }
  });
});
