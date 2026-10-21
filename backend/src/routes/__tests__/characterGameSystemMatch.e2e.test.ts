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

describe('Character assign and create-in match Campaign game system', () => {
  let dmId: string;
  let playerId: string;
  let dndCampaignId: string;
  let untypedCampaignId: string;
  let playerAgent: ReturnType<typeof request.agent>;

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
    dmId = dm.id;
    playerId = player.id;

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
  });

  afterAll(async () => {
    await cleanupCampaigns([dndCampaignId, untypedCampaignId]);
    await cleanupUsers([dmId, playerId]);
    await prisma.$disconnect();
  });

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
