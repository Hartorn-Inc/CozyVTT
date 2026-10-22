/**
 * Frozen Shadowrun 6e Characters refuse live HP and hit-die socket writes
 * (ADR 0013 T4).
 *
 * HTTP create of a Shadowrun sheet is refused, so this seeds via Prisma.
 * After membership and permission checks pass, both live resource events
 * answer `error` with the public freeze message and store nothing.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../../config/database';
import { createWsTestServer, expectNoEvent, waitForEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
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
let playerCookie: string;

function sr6Sheet(): Record<string, unknown> {
  const blank = getBlankCharacterTemplate(GameSystem.SHADOWRUN_6E) as Record<string, unknown>;
  return {
    ...blank,
    characterName: 'Frozen Runner',
    edgePoints: { maximum: 2, current: 2 },
  };
}

const storedData = async (): Promise<unknown> =>
  (await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).data;

beforeAll(async () => {
  const [dm, player] = await Promise.all(
    ['dm', 'player'].map((name) =>
      prisma.user.create({
        data: {
          email: `sr6-frozen-${name}-${runId}@test.cozyvtt.local`,
          passwordHash: 'not-used-by-socket-auth',
          displayName: `SR6 frozen ${name}`,
        },
      })
    )
  );
  dmId = dm.id;
  playerId = player.id;
  const campaign = await prisma.campaign.create({
    data: { name: `SR6 frozen ${runId}`, ownerId: dmId, vibeSettings: {}, gameSystem: GameSystem.SHADOWRUN_6E },
  });
  campaignId = campaign.id;
  const character = await prisma.character.create({
    data: {
      userId: playerId,
      campaignId,
      name: 'Frozen Runner',
      gameSystem: GameSystem.SHADOWRUN_6E,
      data: toJson(sr6Sheet()),
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
  playerCookie = await server.loginAs(playerId);
});

beforeEach(async () => {
  await prisma.character.update({ where: { id: characterId }, data: { data: toJson(sr6Sheet()) } });
});

afterAll(async () => {
  await server?.close();
  await prisma.character.deleteMany({ where: { id: characterId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: { in: [dmId, playerId] } } });
  await prisma.$disconnect();
});

describe('frozen Shadowrun 6e live resource writes', () => {
  it('refuses character.hp.update with the freeze message and stores nothing', async () => {
    const player = await server.connectAndAuth(playerCookie, campaignId);
    const before = JSON.stringify(await storedData());

    const denial = waitForEvent<{ message: string }>(player, 'error');
    const silence = expectNoEvent(player, 'character.hp.updated');
    player.emit('character.hp.update', { characterId, delta: -1 });

    expect(await denial).toEqual({
      message: 'Shadowrun 6e Characters cannot be created or edited until the sheet and an attribution section exist.',
    });
    await silence;
    expect(JSON.stringify(await storedData())).toBe(before);

    player.disconnect();
  });

  it('refuses character.hitdice.spend with the freeze message and stores nothing', async () => {
    const player = await server.connectAndAuth(playerCookie, campaignId);
    const before = JSON.stringify(await storedData());

    const denial = waitForEvent<{ message: string }>(player, 'error');
    const silence = expectNoEvent(player, 'character.updated');
    player.emit('character.hitdice.spend', { characterId, index: 0 });

    expect(await denial).toEqual({
      message: 'Shadowrun 6e Characters cannot be created or edited until the sheet and an attribution section exist.',
    });
    await silence;
    expect(JSON.stringify(await storedData())).toBe(before);

    player.disconnect();
  });
});
