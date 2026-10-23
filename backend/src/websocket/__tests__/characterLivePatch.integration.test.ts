/**
 * Live HP / hit-die patches use the REST Zod seam (ADR 0013).
 *
 * A finite integer HP delta on a playable over-limit sheet succeeds and does
 * not rewrite inventory. The same blob is refused by `prepareSheetForStorage`
 * (the REST save schema). A non-integer delta is refused and stores nothing.
 * Spectator HP and hit-die refusals live in spectatorCharacter.integration.test.ts.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../../config/database';
import { createWsTestServer, waitForEvent, expectNoEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { toJson } from '../../utils/prisma-json';
import { prepareSheetForStorage } from '../../utils/prepareSheet';
import { getBlankCharacterTemplate } from '../../validators/game-systems';
import { SHEET_LIST_MAX } from '../../validators/game-systems/sheetLimits';
import { GameSystem } from '../../game-systems';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);

let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let characterId: string;
let dmCookie: string;

function overLimitSheet(): Record<string, unknown> {
  const blank = getBlankCharacterTemplate(GameSystem.DND_5E) as Record<string, unknown> & {
    hp: { current: number; maximum: number; temporary: number };
    inventory: unknown[];
  };
  return {
    ...blank,
    hp: { ...blank.hp, current: 10, maximum: 12, temporary: 0 },
    inventory: Array.from({ length: SHEET_LIST_MAX + 1 }, () => ({ name: 'Rope' })),
  };
}

const stored = async (): Promise<{ hp: { current: number }; inventory: unknown[] }> =>
  (await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).data as {
    hp: { current: number };
    inventory: unknown[];
  };

beforeAll(async () => {
  const [dm, player] = await Promise.all(
    ['dm', 'player'].map((name) =>
      prisma.user.create({
        data: {
          email: `live-patch-${name}-${runId}@test.cozyvtt.local`,
          passwordHash: 'not-used-by-socket-auth',
          displayName: `Live patch ${name}`,
        },
      })
    )
  );
  dmId = dm.id;
  playerId = player.id;
  const campaign = await prisma.campaign.create({
    data: { name: `Live patch ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: GameSystem.DND_5E },
  });
  campaignId = campaign.id;
  const character = await prisma.character.create({
    data: {
      userId: playerId,
      campaignId,
      name: 'Overpacked',
      gameSystem: GameSystem.DND_5E,
      data: toJson(overLimitSheet()),
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
  await prisma.character.update({ where: { id: characterId }, data: { data: toJson(overLimitSheet()) } });
});

afterAll(async () => {
  await server?.close();
  await prisma.character.deleteMany({ where: { id: characterId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: { in: [dmId, playerId] } } });
  await prisma.$disconnect();
});

describe('live HP patches and the REST Zod seam (ADR 0013)', () => {
  it('applies a finite integer HP delta on a sheet with SHEET_LIST_MAX+1 inventory rows and leaves inventory length unchanged', async () => {
    const dm = await server.connectAndAuth(dmCookie, campaignId);

    const updated = waitForEvent<{ hp: { current: number } }>(dm, 'character.hp.updated');
    dm.emit('character.hp.update', { characterId, delta: -3 });
    expect((await updated).hp.current).toBe(7);

    const after = await stored();
    expect(after.hp.current).toBe(7);
    expect(after.inventory).toHaveLength(SHEET_LIST_MAX + 1);

    dm.disconnect();
  });

  it('is refused by prepareSheetForStorage, the REST save schema (HTTP PUT is covered by sheetListLimits.e2e.test.ts when that suite is mounted)', async () => {
    const data = (await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).data;
    const prepared = prepareSheetForStorage({ gameSystem: GameSystem.DND_5E, data });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.message).toMatch(/does not match/i);
  });

  it('refuses a non-integer HP patch and leaves stored HP unchanged', async () => {
    const dm = await server.connectAndAuth(dmCookie, campaignId);

    const denial = waitForEvent<{ message: string }>(dm, 'error');
    const silence = expectNoEvent(dm, 'character.hp.updated');
    dm.emit('character.hp.update', { characterId, delta: 1.5 });
    expect((await denial).message).toMatch(/integer/i);
    await silence;
    expect((await stored()).hp.current).toBe(10);

    const nanDenial = waitForEvent<{ message: string }>(dm, 'error');
    dm.emit('character.hp.update', { characterId, delta: Number.NaN });
    expect((await nanDenial).message).toMatch(/integer|delta/i);
    expect((await stored()).hp.current).toBe(10);

    dm.disconnect();
  });
});
