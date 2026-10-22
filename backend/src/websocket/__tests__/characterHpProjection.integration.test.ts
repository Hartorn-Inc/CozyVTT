/**
 * Live HP deltas clamp against the projected maximum, not the stored cache.
 *
 * REST roster and sheet-save already extract/broadcast projected max HP. The
 * live `character.hp.update` path used to clamp and broadcast the stored
 * cache, so a Pathfinder sheet with `hp.maximum: 1` and inputs that project
 * to 22 showed 7/22 on the roster, then +/- wrote current 7→1 and broadcast
 * `{current:1, max:1}`. Current resources are writes and are never overwritten
 * by projection (ADR 0013); only `hp.current` is persisted.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../../config/database';
import { createWsTestServer, waitForEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { toJson } from '../../utils/prisma-json';
import { getBlankCharacterTemplate } from '../../validators/game-systems';
import { GameSystem } from '../../game-systems';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);

let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let characterId: string;
let dmCookie: string;

type StoredHp = { current: number; maximum: number; temporary: number };

function pf2eConSheet(): Record<string, unknown> {
  const blank = getBlankCharacterTemplate(GameSystem.PATHFINDER_2E) as Record<string, unknown> & {
    attributes: Record<string, { score: number; modifier: number }>;
    hp: Record<string, unknown>;
  };
  return {
    ...blank,
    level: 1,
    attributes: {
      ...blank.attributes,
      constitution: { score: 14, modifier: 2 },
    },
    hp: {
      ...blank.hp,
      ancestryHp: 10,
      classHpPerLevel: 10,
      maximum: 1,
      current: 7,
      temporary: 0,
    },
  };
}

const storedHp = async (): Promise<StoredHp> =>
  ((await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).data as { hp: StoredHp }).hp;

beforeAll(async () => {
  const [dm, player] = await Promise.all(
    ['dm', 'player'].map((name) =>
      prisma.user.create({
        data: {
          email: `hp-proj-${name}-${runId}@test.cozyvtt.local`,
          passwordHash: 'not-used-by-socket-auth',
          displayName: `HP proj ${name}`,
        },
      })
    )
  );
  dmId = dm.id;
  playerId = player.id;
  const campaign = await prisma.campaign.create({
    data: { name: `HP proj ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: GameSystem.PATHFINDER_2E },
  });
  campaignId = campaign.id;
  const character = await prisma.character.create({
    data: {
      userId: playerId,
      campaignId,
      name: 'Seelah',
      gameSystem: GameSystem.PATHFINDER_2E,
      data: toJson(pf2eConSheet()),
    },
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
  await prisma.character.update({ where: { id: characterId }, data: { data: toJson(pf2eConSheet()) } });
});

afterAll(async () => {
  await server?.close();
  await prisma.character.deleteMany({ where: { id: characterId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: { in: [dmId, playerId] } } });
  await prisma.$disconnect();
});

describe('character.hp.update against a projected Pathfinder maximum', () => {
  it('clamps and broadcasts the projected max and writes only current HP', async () => {
    const dm = await server.connectAndAuth(dmCookie, campaignId);

    const updated = waitForEvent<{ characterId: string; hp: { current: number; max: number; temp: number } }>(
      dm,
      'character.hp.updated'
    );
    dm.emit('character.hp.update', { characterId, delta: -1 });

    expect(await updated).toEqual({
      characterId,
      hp: { current: 6, max: 22, temp: 0 },
    });
    const hp = await storedHp();
    expect(hp.current).toBe(6);
    expect(hp.maximum).toBe(1);

    dm.disconnect();
  });
});
