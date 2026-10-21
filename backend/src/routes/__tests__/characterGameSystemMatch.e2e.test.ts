/**
 * Character assign and create-in match the Campaign's game system.
 *
 * A typed Campaign accepts only a Character of that same system, including
 * refusing a Flexible sheet. A Campaign with no game system accepts any
 * Character. Existing mismatches still load; the next mismatched write is 400.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { GameSystem } from '@prisma/client';
import request from 'supertest';
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
const userIds: string[] = [];
const campaignIds: string[] = [];
let player: { id: string; agent: ReturnType<typeof request.agent> };
let outsider: { id: string; agent: ReturnType<typeof request.agent> };

const mismatchMessage = (characterSystem: string, campaignSystem: string) =>
  `Cannot assign a ${characterSystem} character to a ${campaignSystem} campaign. Character and campaign game systems must match.`;

async function signedIn() {
  const user = await createTestUser({ displayName: 'Match player' });
  userIds.push(user.id);
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(200);
  return { id: user.id, agent };
}

async function campaign(gameSystem: GameSystem | null) {
  const created = await createTestCampaign(player.id, { gameSystem });
  campaignIds.push(created.id);
  await prisma.campaignMembership.create({
    data: { userId: player.id, campaignId: created.id, role: 'DM', characterIds: [] },
  });
  return created;
}

const ownedCharacter = (name: string, gameSystem: GameSystem | null) =>
  prisma.character.create({ data: { userId: player.id, name, gameSystem, data: {} } });

beforeAll(async () => {
  player = await signedIn();
  outsider = await signedIn();
});

afterAll(async () => {
  await cleanupCampaigns(campaignIds);
  await cleanupUsers(userIds);
  await prisma.$disconnect();
});

describe('POST /api/characters/:id/assign', () => {
  it('refuses a PATHFINDER_2E Character into a DND_5E Campaign', async () => {
    const target = await campaign('DND_5E');
    const hero = await ownedCharacter('Pathfinder at a D&D table', 'PATHFINDER_2E');

    const res = await player.agent.post(`/api/characters/${hero.id}/assign`).send({ campaignId: target.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Game System Mismatch');
    expect(res.body.message).toBe(mismatchMessage('PATHFINDER_2E', 'DND_5E'));
    expect((await prisma.character.findUnique({ where: { id: hero.id } }))?.campaignId).toBeNull();
  });

  it('assigns a DND_5E Character into a DND_5E Campaign', async () => {
    const target = await campaign('DND_5E');
    const hero = await ownedCharacter('Matching D&D hero', 'DND_5E');

    const res = await player.agent.post(`/api/characters/${hero.id}/assign`).send({ campaignId: target.id });

    expect(res.status).toBe(200);
    expect((await prisma.character.findUnique({ where: { id: hero.id } }))?.campaignId).toBe(target.id);
  });

  it('assigns a DND_5E Character into a Campaign with no game system', async () => {
    const target = await campaign(null);
    const hero = await ownedCharacter('D&D hero, untyped table', 'DND_5E');

    const res = await player.agent.post(`/api/characters/${hero.id}/assign`).send({ campaignId: target.id });

    expect(res.status).toBe(200);
    expect((await prisma.character.findUnique({ where: { id: hero.id } }))?.campaignId).toBe(target.id);
  });

  it('refuses a Flexible Character into a typed Campaign', async () => {
    const target = await campaign('DND_5E');
    const hero = await ownedCharacter('Flexible at a D&D table', null);

    const res = await player.agent.post(`/api/characters/${hero.id}/assign`).send({ campaignId: target.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Game System Mismatch');
    expect(res.body.message).toBe(mismatchMessage('flexible', 'DND_5E'));
    expect((await prisma.character.findUnique({ where: { id: hero.id } }))?.campaignId).toBeNull();
  });
});

describe('GET /api/characters/:id', () => {
  it('loads a Character already in the wrong Campaign', async () => {
    const target = await campaign('DND_5E');
    const hero = await prisma.character.create({
      data: {
        userId: player.id,
        campaignId: target.id,
        name: 'Already mismatched',
        gameSystem: 'PATHFINDER_2E',
        data: {},
      },
    });

    const res = await player.agent.get(`/api/characters/${hero.id}`);

    expect(res.status).toBe(200);
    expect(res.body.character.id).toBe(hero.id);
    expect(res.body.character.campaignId).toBe(target.id);
  });
});

describe('POST /api/characters create-in', () => {
  it('refuses a PATHFINDER_2E Character into a DND_5E Campaign and creates nothing', async () => {
    const target = await campaign('DND_5E');
    const before = await prisma.character.count({ where: { userId: player.id } });

    const res = await player.agent.post('/api/characters').send({
      name: 'Mismatched create-in',
      gameSystem: 'PATHFINDER_2E',
      campaignId: target.id,
      data: getBlankTemplate(GameSystem.PATHFINDER_2E).data,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Game System Mismatch');
    expect(res.body.message).toBe(mismatchMessage('PATHFINDER_2E', 'DND_5E'));
    expect(await prisma.character.count({ where: { userId: player.id } })).toBe(before);
  });

  it('creates a DND_5E Character in a DND_5E Campaign', async () => {
    const target = await campaign('DND_5E');

    const res = await player.agent.post('/api/characters').send({
      name: 'Matching create-in',
      gameSystem: 'DND_5E',
      campaignId: target.id,
      data: getBlankTemplate(GameSystem.DND_5E).data,
    });

    expect(res.status).toBe(201);
    expect(res.body.character.campaignId).toBe(target.id);
    expect(res.body.character.gameSystem).toBe('DND_5E');
  });

  it('creates a DND_5E Character in a Campaign with no game system', async () => {
    const target = await campaign(null);

    const res = await player.agent.post('/api/characters').send({
      name: 'Typed create-in, untyped table',
      gameSystem: 'DND_5E',
      campaignId: target.id,
      data: getBlankTemplate(GameSystem.DND_5E).data,
    });

    expect(res.status).toBe(201);
    expect(res.body.character.campaignId).toBe(target.id);
    expect(res.body.character.gameSystem).toBe('DND_5E');
  });

  it('inherits an omitted gameSystem from a DND_5E Campaign', async () => {
    const target = await campaign('DND_5E');

    const res = await player.agent.post('/api/characters').send({
      name: 'Inherit omitted gameSystem',
      campaignId: target.id,
      data: getBlankTemplate(GameSystem.DND_5E).data,
    });

    expect(res.status).toBe(201);
    expect(res.body.character.campaignId).toBe(target.id);
    expect(res.body.character.gameSystem).toBe('DND_5E');
  });

  it('inherits an explicit null gameSystem from a DND_5E Campaign', async () => {
    const target = await campaign('DND_5E');

    const res = await player.agent.post('/api/characters').send({
      name: 'Inherit null gameSystem',
      gameSystem: null,
      campaignId: target.id,
      data: getBlankTemplate(GameSystem.DND_5E).data,
    });

    expect(res.status).toBe(201);
    expect(res.body.character.campaignId).toBe(target.id);
    expect(res.body.character.gameSystem).toBe('DND_5E');
  });

  it('refuses create-in by a non-member before checking game systems', async () => {
    const target = await campaign('DND_5E');
    const before = await prisma.character.count({ where: { userId: outsider.id } });

    const res = await outsider.agent.post('/api/characters').send({
      name: 'Outsider create-in',
      gameSystem: 'PATHFINDER_2E',
      campaignId: target.id,
      data: getBlankTemplate(GameSystem.PATHFINDER_2E).data,
    });

    expect(res.status).toBe(403);
    expect(res.body.error).not.toBe('Game System Mismatch');
    expect(await prisma.character.count({ where: { userId: outsider.id } })).toBe(before);
  });
});
