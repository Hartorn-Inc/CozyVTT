/**
 * Derived values on REST reads: Pathfinder max HP from CON, Call of Cthulhu
 * sanity from Mythos. Stored caches can be stale; GET and the campaign roster
 * project at read and leave current resources as they were stored.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
import type { Prisma } from '@prisma/client';
import { GameSystem as PrismaGameSystem } from '@prisma/client';
import { createTestApp } from '../../__tests__/helpers/test-app';
import {
  prisma,
  createTestUser,
  createTestCampaign,
  cleanupUsers,
  cleanupCampaigns,
  TEST_PASSWORD,
} from '../../__tests__/helpers/db';
import { getBlankCharacterTemplate } from '../../validators/game-systems';
import { GameSystem } from '../../game-systems';

const app = createTestApp();

type RosterMember = {
  characters: Array<{
    id: string;
    hp: { current: number; max: number; temp: number } | null;
  }>;
};

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
    },
  };
}

function cocMythosSheet(sanityMaximum: number): Record<string, unknown> {
  const blank = getBlankCharacterTemplate(GameSystem.CALL_OF_CTHULHU_7E) as Record<string, unknown> & {
    skills: { cthulhuMythos: Record<string, unknown> };
    derivedStats: { sanity: Record<string, unknown> };
  };
  return {
    ...blank,
    skills: {
      ...blank.skills,
      cthulhuMythos: { ...blank.skills.cthulhuMythos, currentValue: 100 },
    },
    derivedStats: {
      ...blank.derivedStats,
      sanity: {
        ...blank.derivedStats.sanity,
        starting: 50,
        maximum: sanityMaximum,
        current: 40,
      },
    },
  };
}

describe('projected derived values on REST reads', () => {
  let playerId: string;
  let dmId: string;
  let pf2eCampaignId: string;
  let playerAgent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const stamp = Date.now();
    const dm = await createTestUser({ displayName: 'Derived DM' });
    const player = await createTestUser({ displayName: 'Derived Player' });
    dmId = dm.id;
    playerId = player.id;

    const campaign = await createTestCampaign(dmId, {
      name: `Derived PF2e ${stamp}`,
      gameSystem: PrismaGameSystem.PATHFINDER_2E,
    });
    pf2eCampaignId = campaign.id;

    await prisma.campaignMembership.createMany({
      data: [
        { campaignId: pf2eCampaignId, userId: dmId, role: 'DM', characterIds: [] },
        { campaignId: pf2eCampaignId, userId: playerId, role: 'PLAYER', characterIds: [] },
      ],
    });

    playerAgent = request.agent(app);
    const login = await playerAgent
      .post('/api/auth/login')
      .send({ email: player.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
  });

  afterAll(async () => {
    await cleanupCampaigns([pf2eCampaignId]);
    await cleanupUsers([dmId, playerId]);
    await prisma.$disconnect();
  });

  it('projects Pathfinder max HP from CON on GET and the campaign roster, leaving current HP', async () => {
    const created = await playerAgent.post('/api/characters').send({
      name: 'Seelah',
      gameSystem: GameSystem.PATHFINDER_2E,
      campaignId: pf2eCampaignId,
      data: pf2eConSheet(),
    });
    expect(created.status).toBe(201);
    const id = created.body.character.id as string;
    expect(created.body.character.data.hp.maximum).toBe(22);
    expect(created.body.character.data.hp.current).toBe(7);

    const stored = await prisma.character.findUniqueOrThrow({ where: { id } });
    expect((stored.data as { hp: { maximum: number; current: number } }).hp.maximum).toBe(1);
    expect((stored.data as { hp: { current: number } }).hp.current).toBe(7);

    const loaded = await playerAgent.get(`/api/characters/${id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.character.data.hp.maximum).toBe(22);
    expect(loaded.body.character.data.hp.current).toBe(7);

    const roster = await playerAgent.get(`/api/campaigns/${pf2eCampaignId}/characters`);
    expect(roster.status).toBe(200);
    const listed = (roster.body.roster as RosterMember[])
      .flatMap((member) => member.characters)
      .find((character) => character.id === id);
    expect(listed?.hp).toEqual({ current: 7, max: 22, temp: 0 });
    expect(JSON.stringify(roster.body)).not.toContain('"ancestryHp"');
  });

  it('accepts Mythos 100 on PUT and projects sanity maximum 0 without changing current', async () => {
    const created = await playerAgent.post('/api/characters').send({
      name: 'Harvey Walters',
      gameSystem: GameSystem.CALL_OF_CTHULHU_7E,
      data: getBlankCharacterTemplate(GameSystem.CALL_OF_CTHULHU_7E),
    });
    expect(created.status).toBe(201);
    const id = created.body.character.id as string;

    const saved = await playerAgent.put(`/api/characters/${id}`).send({ data: cocMythosSheet(99) });
    expect(saved.status).toBe(200);
    expect(saved.body.character.data.derivedStats.sanity.maximum).toBe(0);
    expect(saved.body.character.data.derivedStats.sanity.current).toBe(40);

    const loaded = await playerAgent.get(`/api/characters/${id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.character.data.derivedStats.sanity.maximum).toBe(0);
    expect(loaded.body.character.data.derivedStats.sanity.current).toBe(40);
    expect(loaded.body.character.data.skills.cthulhuMythos.currentValue).toBe(100);
  });

  it('projects sanity maximum 0 from a planted Mythos 100 sheet', async () => {
    const planted = await prisma.character.create({
      data: {
        userId: playerId,
        name: 'Planted Mythos',
        gameSystem: PrismaGameSystem.CALL_OF_CTHULHU_7E,
        data: cocMythosSheet(99) as Prisma.InputJsonValue,
      },
    });

    const loaded = await playerAgent.get(`/api/characters/${planted.id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.character.data.derivedStats.sanity.maximum).toBe(0);
    expect(loaded.body.character.data.derivedStats.sanity.current).toBe(40);

    const stored = await prisma.character.findUniqueOrThrow({ where: { id: planted.id } });
    expect((stored.data as { derivedStats: { sanity: { maximum: number } } }).derivedStats.sanity.maximum).toBe(99);
  });
});
