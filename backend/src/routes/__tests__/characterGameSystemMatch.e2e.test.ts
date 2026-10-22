/**
 * Character create-in and assign match the Campaign game system (ADR 0015).
 *
 * A typed Campaign refuses a Character of another system, including a
 * Flexible sheet. A Campaign with no game system accepts any Character.
 * Existing mismatches still load (GET 200); the next mismatched write is 400.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
import { GameSystem } from '@prisma/client';
import { createTestApp } from '../../__tests__/helpers/test-app';
import {
  prisma,
  createTestUser,
  createTestCampaign,
  cleanupUsers,
  cleanupCampaigns,
  TEST_PASSWORD,
} from '../../__tests__/helpers/db';
import { getBlankTemplate } from '../../utils/character-templates';

jest.setTimeout(30000);

const app = createTestApp();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hold the Campaign row, then commit a change of gameSystem.
 * Models a concurrent PUT /api/campaigns/:id while a join is in flight.
 */
async function holdCampaignThenSetSystem(
  campaignId: string,
  gameSystem: GameSystem | null,
): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const hasLocked = new Promise<void>((resolve) => {
    locked = resolve;
  });

  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`;
      locked();
      await released;
      await tx.campaign.update({
        where: { id: campaignId },
        data: { gameSystem },
      });
    },
    { timeout: 15000 },
  );

  await hasLocked;
  return {
    release: async () => {
      release();
      await holder;
    },
  };
}

describe('Character assign and create-in match Campaign game system', () => {
  let dmId: string;
  let playerId: string;
  let outsiderId: string;
  let dndCampaignId: string;
  let untypedCampaignId: string;
  const extraCampaignIds: string[] = [];
  let playerAgent: ReturnType<typeof request.agent>;
  let outsiderAgent: ReturnType<typeof request.agent>;

  const signIn = async (email: string) => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
    return agent;
  };

  const dndSheet = () => getBlankTemplate(GameSystem.DND_5E).data;
  const pfSheet = () => getBlankTemplate(GameSystem.PATHFINDER_2E).data;

  const createCharacter = (body: Record<string, unknown>) =>
    playerAgent.post('/api/characters').send(body);

  const assign = (characterId: string, campaignId: string | null) =>
    playerAgent.post(`/api/characters/${characterId}/assign`).send({ campaignId });

  const membershipFor = (userId: string, campaignId: string) =>
    prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId, campaignId } },
    });

  beforeAll(async () => {
    const stamp = Date.now();
    const dm = await createTestUser({ email: `gsmatch_dm_${stamp}@test.invalid`, isApproved: true });
    const player = await createTestUser({ email: `gsmatch_pl_${stamp}@test.invalid`, isApproved: true });
    const outsider = await createTestUser({ email: `gsmatch_out_${stamp}@test.invalid`, isApproved: true });
    dmId = dm.id;
    playerId = player.id;
    outsiderId = outsider.id;

    const dndCampaign = await createTestCampaign(dmId, { name: `D&D ${stamp}`, gameSystem: GameSystem.DND_5E });
    const untypedCampaign = await createTestCampaign(dmId, { name: `Untyped ${stamp}`, gameSystem: null });
    dndCampaignId = dndCampaign.id;
    untypedCampaignId = untypedCampaign.id;

    await prisma.campaignMembership.createMany({
      data: [
        { userId: dmId, campaignId: dndCampaignId, role: 'DM', characterIds: [] },
        { userId: playerId, campaignId: dndCampaignId, role: 'PLAYER', characterIds: [] },
        { userId: dmId, campaignId: untypedCampaignId, role: 'DM', characterIds: [] },
        { userId: playerId, campaignId: untypedCampaignId, role: 'PLAYER', characterIds: [] },
      ],
    });

    playerAgent = await signIn(`gsmatch_pl_${stamp}@test.invalid`);
    outsiderAgent = await signIn(`gsmatch_out_${stamp}@test.invalid`);
  });

  afterAll(async () => {
    await cleanupCampaigns([dndCampaignId, untypedCampaignId, ...extraCampaignIds]);
    await cleanupUsers([dmId, playerId, outsiderId]);
    await prisma.$disconnect();
  });

  const campaignForRace = async (name: string, gameSystem: GameSystem | null) => {
    const campaign = await createTestCampaign(dmId, { name, gameSystem });
    extraCampaignIds.push(campaign.id);
    await prisma.campaignMembership.createMany({
      data: [
        { userId: dmId, campaignId: campaign.id, role: 'DM', characterIds: [] },
        { userId: playerId, campaignId: campaign.id, role: 'PLAYER', characterIds: [] },
      ],
    });
    return campaign.id;
  };

  const untypedCampaignForRace = (name: string) => campaignForRace(name, null);
  const dndCampaignForRace = (name: string) => campaignForRace(name, GameSystem.DND_5E);

  it('refuses assigning a Pathfinder Character into a D&D Campaign', async () => {
    const created = await createCharacter({
      name: 'PF into D&D assign',
      gameSystem: GameSystem.PATHFINDER_2E,
      data: pfSheet(),
    }).expect(201);
    const characterId: string = created.body.character.id;
    const beforeCount = (await membershipFor(playerId, dndCampaignId))?.characterIds.length ?? 0;

    const res = await assign(characterId, dndCampaignId);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Game System Mismatch');
    expect((await prisma.character.findUnique({ where: { id: characterId } }))?.campaignId).toBeNull();
    expect((await membershipFor(playerId, dndCampaignId))?.characterIds).not.toContain(characterId);
    expect((await membershipFor(playerId, dndCampaignId))?.characterIds.length ?? 0).toBe(beforeCount);
  });

  it('refuses create-in of a Pathfinder Character into a D&D Campaign', async () => {
    const before = await prisma.character.count({ where: { userId: playerId } });
    const beforeMembership = (await membershipFor(playerId, dndCampaignId))?.characterIds.length ?? 0;

    const res = await createCharacter({
      name: 'PF create-in D&D',
      campaignId: dndCampaignId,
      gameSystem: GameSystem.PATHFINDER_2E,
      data: pfSheet(),
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Game System Mismatch');
    expect(await prisma.character.count({ where: { userId: playerId } })).toBe(before);
    expect(await prisma.character.findFirst({ where: { userId: playerId, name: 'PF create-in D&D' } })).toBeNull();
    expect((await membershipFor(playerId, dndCampaignId))?.characterIds.length ?? 0).toBe(beforeMembership);
  });

  it('assigns a D&D Character into a D&D Campaign', async () => {
    const created = await createCharacter({
      name: 'D&D into D&D assign',
      gameSystem: GameSystem.DND_5E,
      data: dndSheet(),
    }).expect(201);
    const characterId: string = created.body.character.id;

    const res = await assign(characterId, dndCampaignId);

    expect(res.status).toBe(200);
    expect((await prisma.character.findUnique({ where: { id: characterId } }))?.campaignId).toBe(dndCampaignId);
    expect((await membershipFor(playerId, dndCampaignId))?.characterIds).toContain(characterId);
  });

  it('creates a D&D Character into a D&D Campaign', async () => {
    const res = await createCharacter({
      name: 'D&D create-in D&D',
      campaignId: dndCampaignId,
      gameSystem: GameSystem.DND_5E,
      data: dndSheet(),
    });

    expect(res.status).toBe(201);
    expect(res.body.character.campaignId).toBe(dndCampaignId);
    expect(res.body.character.gameSystem).toBe(GameSystem.DND_5E);
    expect((await membershipFor(playerId, dndCampaignId))?.characterIds).toContain(res.body.character.id);
  });

  it('assigns a D&D Character into a Campaign with no game system', async () => {
    const created = await createCharacter({
      name: 'D&D into untyped assign',
      gameSystem: GameSystem.DND_5E,
      data: dndSheet(),
    }).expect(201);
    const characterId: string = created.body.character.id;

    const res = await assign(characterId, untypedCampaignId);

    expect(res.status).toBe(200);
    expect((await prisma.character.findUnique({ where: { id: characterId } }))?.campaignId).toBe(untypedCampaignId);
    expect((await membershipFor(playerId, untypedCampaignId))?.characterIds).toContain(characterId);
  });

  it('creates a D&D Character into a Campaign with no game system', async () => {
    const res = await createCharacter({
      name: 'D&D create-in untyped',
      campaignId: untypedCampaignId,
      gameSystem: GameSystem.DND_5E,
      data: dndSheet(),
    });

    expect(res.status).toBe(201);
    expect(res.body.character.campaignId).toBe(untypedCampaignId);
    expect(res.body.character.gameSystem).toBe(GameSystem.DND_5E);
    expect((await membershipFor(playerId, untypedCampaignId))?.characterIds).toContain(res.body.character.id);
  });

  it('refuses assigning a Flexible Character into a typed Campaign', async () => {
    const created = await createCharacter({
      name: 'Flexible into typed assign',
      gameSystem: null,
    }).expect(201);
    const characterId: string = created.body.character.id;

    const res = await assign(characterId, dndCampaignId);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Game System Mismatch');
    expect((await prisma.character.findUnique({ where: { id: characterId } }))?.campaignId).toBeNull();
    expect((await membershipFor(playerId, dndCampaignId))?.characterIds).not.toContain(characterId);
  });

  it('still returns GET 200 for a Character already in the wrong Campaign', async () => {
    const created = await createCharacter({
      name: 'Existing mismatch GET',
      gameSystem: GameSystem.PATHFINDER_2E,
      data: pfSheet(),
    }).expect(201);
    const characterId: string = created.body.character.id;

    await prisma.character.update({
      where: { id: characterId },
      data: { campaignId: dndCampaignId },
    });

    const res = await playerAgent.get(`/api/characters/${characterId}`);

    expect(res.status).toBe(200);
    expect(res.body.character.id).toBe(characterId);
    expect(res.body.character.campaignId).toBe(dndCampaignId);
  });

  it('inherits the Campaign game system when create-in omits gameSystem', async () => {
    const res = await createCharacter({
      name: 'Inherit D&D create-in',
      campaignId: dndCampaignId,
      data: dndSheet(),
    });

    expect(res.status).toBe(201);
    expect(res.body.character.gameSystem).toBe(GameSystem.DND_5E);
    expect(res.body.character.campaignId).toBe(dndCampaignId);
  });

  it('inherits an explicit null gameSystem from a DND_5E Campaign', async () => {
    const res = await createCharacter({
      name: 'Inherit null gameSystem',
      gameSystem: null,
      campaignId: dndCampaignId,
      data: dndSheet(),
    });

    expect(res.status).toBe(201);
    expect(res.body.character.campaignId).toBe(dndCampaignId);
    expect(res.body.character.gameSystem).toBe(GameSystem.DND_5E);
  });

  it('refuses create-in by a non-member before checking game systems', async () => {
    const before = await prisma.character.count({ where: { userId: outsiderId } });

    const res = await outsiderAgent.post('/api/characters').send({
      name: 'Outsider create-in',
      gameSystem: GameSystem.PATHFINDER_2E,
      campaignId: dndCampaignId,
      data: pfSheet(),
    });

    expect(res.status).toBe(403);
    expect(res.body.error).not.toBe('Game System Mismatch');
    expect(await prisma.character.count({ where: { userId: outsiderId } })).toBe(before);
  });

  it('unassigns an existing mismatch', async () => {
    const created = await createCharacter({
      name: 'Mismatch unassign',
      gameSystem: GameSystem.PATHFINDER_2E,
      data: pfSheet(),
    }).expect(201);
    const characterId: string = created.body.character.id;

    await prisma.character.update({
      where: { id: characterId },
      data: { campaignId: dndCampaignId },
    });
    await prisma.campaignMembership.update({
      where: { userId_campaignId: { userId: playerId, campaignId: dndCampaignId } },
      data: { characterIds: { push: characterId } },
    });

    const res = await assign(characterId, null);

    expect(res.status).toBe(200);
    expect((await prisma.character.findUnique({ where: { id: characterId } }))?.campaignId).toBeNull();
    expect((await membershipFor(playerId, dndCampaignId))?.characterIds).not.toContain(characterId);
  });

  it('refuses assign when a concurrent PUT types the Campaign as D&D', async () => {
    const campaignId = await untypedCampaignForRace(`Race assign ${Date.now()}`);
    const created = await createCharacter({
      name: 'PF race assign',
      gameSystem: GameSystem.PATHFINDER_2E,
      data: pfSheet(),
    }).expect(201);
    const characterId: string = created.body.character.id;

    const holder = await holdCampaignThenSetSystem(campaignId, GameSystem.DND_5E);
    const join = assign(characterId, campaignId);
    await sleep(500);
    await holder.release();
    const res = await join;

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Game System Mismatch');
    expect((await prisma.character.findUnique({ where: { id: characterId } }))?.campaignId).toBeNull();
    expect((await membershipFor(playerId, campaignId))?.characterIds).not.toContain(characterId);
  });

  it('refuses create-in when a concurrent PUT types the Campaign as D&D', async () => {
    const campaignId = await untypedCampaignForRace(`Race create-in ${Date.now()}`);
    const before = await prisma.character.count({ where: { userId: playerId } });
    const beforeMembership = (await membershipFor(playerId, campaignId))?.characterIds.length ?? 0;

    const holder = await holdCampaignThenSetSystem(campaignId, GameSystem.DND_5E);
    const join = createCharacter({
      name: 'PF race create-in',
      campaignId,
      gameSystem: GameSystem.PATHFINDER_2E,
      data: pfSheet(),
    });
    await sleep(500);
    await holder.release();
    const res = await join;

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Game System Mismatch');
    expect(await prisma.character.count({ where: { userId: playerId } })).toBe(before);
    expect(await prisma.character.findFirst({ where: { userId: playerId, name: 'PF race create-in' } })).toBeNull();
    expect((await membershipFor(playerId, campaignId))?.characterIds.length ?? 0).toBe(beforeMembership);
  });

  it('inherits the locked Campaign system when omitted create-in races untyped to D&D', async () => {
    const campaignId = await untypedCampaignForRace(`Race inherit omitted ${Date.now()}`);

    const holder = await holdCampaignThenSetSystem(campaignId, GameSystem.DND_5E);
    const join = createCharacter({
      name: 'Omitted inherit race to D&D',
      campaignId,
      data: dndSheet(),
    });
    await sleep(500);
    await holder.release();
    const res = await join;

    expect(res.status).toBe(201);
    expect(res.body.character.gameSystem).toBe(GameSystem.DND_5E);
    expect(res.body.character.campaignId).toBe(campaignId);
    expect((await prisma.character.findUnique({ where: { id: res.body.character.id } }))?.gameSystem).toBe(
      GameSystem.DND_5E,
    );
    expect((await membershipFor(playerId, campaignId))?.characterIds).toContain(res.body.character.id);
  });

  it('inherits the locked Campaign system when null create-in races D&D to untyped', async () => {
    const campaignId = await dndCampaignForRace(`Race inherit null ${Date.now()}`);

    const holder = await holdCampaignThenSetSystem(campaignId, null);
    const join = createCharacter({
      name: 'Null inherit race to untyped',
      campaignId,
      gameSystem: null,
      data: dndSheet(),
    });
    await sleep(500);
    await holder.release();
    const res = await join;

    expect(res.status).toBe(201);
    expect(res.body.character.gameSystem).toBeNull();
    expect(res.body.character.campaignId).toBe(campaignId);
    expect((await prisma.character.findUnique({ where: { id: res.body.character.id } }))?.gameSystem).toBeNull();
    expect((await membershipFor(playerId, campaignId))?.characterIds).toContain(res.body.character.id);
  });

  it('answers 400 when omitted inherit re-preps a Flexible sheet against a newly typed Campaign', async () => {
    const campaignId = await untypedCampaignForRace(`Race inherit Flexible re-prep ${Date.now()}`);
    const before = await prisma.character.count({ where: { userId: playerId } });
    const beforeMembership = (await membershipFor(playerId, campaignId))?.characterIds.length ?? 0;

    const holder = await holdCampaignThenSetSystem(campaignId, GameSystem.DND_5E);
    const join = createCharacter({
      name: 'Omitted inherit Flexible re-prep',
      campaignId,
      data: { sections: [] },
    });
    await sleep(500);
    await holder.release();
    const res = await join;

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation Error');
    expect(await prisma.character.count({ where: { userId: playerId } })).toBe(before);
    expect(
      await prisma.character.findFirst({ where: { userId: playerId, name: 'Omitted inherit Flexible re-prep' } }),
    ).toBeNull();
    expect((await membershipFor(playerId, campaignId))?.characterIds.length ?? 0).toBe(beforeMembership);
  });

  it('does not re-inherit an explicit sent system when a concurrent PUT untypes the Campaign', async () => {
    const campaignId = await dndCampaignForRace(`Race explicit D&D stays ${Date.now()}`);

    const holder = await holdCampaignThenSetSystem(campaignId, null);
    const join = createCharacter({
      name: 'Explicit D&D not re-inherited',
      campaignId,
      gameSystem: GameSystem.DND_5E,
      data: dndSheet(),
    });
    await sleep(500);
    await holder.release();
    const res = await join;

    expect(res.status).toBe(201);
    expect(res.body.character.gameSystem).toBe(GameSystem.DND_5E);
    expect(res.body.character.campaignId).toBe(campaignId);
    expect((await prisma.character.findUnique({ where: { id: res.body.character.id } }))?.gameSystem).toBe(
      GameSystem.DND_5E,
    );
    expect((await membershipFor(playerId, campaignId))?.characterIds).toContain(res.body.character.id);
  });

  it('refuses re-assigning a mismatched Character to the Campaign it is already in', async () => {
    const created = await createCharacter({
      name: 'Mismatch re-assign',
      gameSystem: GameSystem.PATHFINDER_2E,
      data: pfSheet(),
    }).expect(201);
    const characterId: string = created.body.character.id;

    await prisma.character.update({
      where: { id: characterId },
      data: { campaignId: dndCampaignId },
    });

    const res = await assign(characterId, dndCampaignId);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Game System Mismatch');
    expect((await prisma.character.findUnique({ where: { id: characterId } }))?.campaignId).toBe(dndCampaignId);
  });
});
