/**
 * Shadowrun 6e Characters stay readable, assignable, and deletable. Create,
 * template publish, sheet-data updates, and copies are refused until the
 * sheet and an attribution section exist (ADR 0013 / issue #61).
 *
 * Existing rows are seeded with Prisma: HTTP POST cannot create them.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
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
import { toJson } from '../../utils/prisma-json';

jest.setTimeout(30000);

const app = createTestApp();

const sr6Sheet = () => getBlankCharacterTemplate(GameSystem.SHADOWRUN_6E);
const dndSheet = () => getBlankCharacterTemplate(GameSystem.DND_5E);

function expectFrozen(res: { status: number; body: { error?: string; code?: string; message?: string } }) {
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('Bad Request');
  expect(res.body.code).toBe('GAME_SYSTEM_SHEET_FROZEN');
  expect(res.body.message).toBe(
    'Shadowrun 6e Characters cannot be created or edited until the sheet and an attribution section exist.',
  );
}

describe('Shadowrun 6e sheet freeze (HTTP)', () => {
  let userId: string;
  let outsiderId: string;
  let agent: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  let untypedCampaignId: string;
  let dndCampaignId: string;
  let sr6CampaignId: string;
  let characterId: string;
  const extraCharacterIds: string[] = [];

  beforeAll(async () => {
    const stamp = Date.now();
    const user = await createTestUser({
      email: `sr6freeze_${stamp}@test.invalid`,
      displayName: 'Runner Owner',
    });
    const outsiderUser = await createTestUser({
      email: `sr6freeze_out_${stamp}@test.invalid`,
      displayName: 'Stranger',
    });
    userId = user.id;
    outsiderId = outsiderUser.id;

    const untyped = await createTestCampaign(userId, { name: `Untyped ${stamp}`, gameSystem: null });
    const dnd = await createTestCampaign(userId, { name: `D&D ${stamp}`, gameSystem: PrismaGameSystem.DND_5E });
    const sr6 = await createTestCampaign(userId, { name: `SR6 ${stamp}`, gameSystem: PrismaGameSystem.SHADOWRUN_6E });
    untypedCampaignId = untyped.id;
    dndCampaignId = dnd.id;
    sr6CampaignId = sr6.id;

    await prisma.campaignMembership.createMany({
      data: [
        { userId, campaignId: untypedCampaignId, role: 'PLAYER', characterIds: [] },
        { userId, campaignId: dndCampaignId, role: 'PLAYER', characterIds: [] },
        { userId, campaignId: sr6CampaignId, role: 'PLAYER', characterIds: [] },
      ],
    });

    agent = request.agent(app);
    expect((await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(200);
    outsider = request.agent(app);
    expect(
      (await outsider.post('/api/auth/login').send({ email: outsiderUser.email, password: TEST_PASSWORD })).status,
    ).toBe(200);

    const seeded = await prisma.character.create({
      data: {
        userId,
        name: 'Existing Runner',
        gameSystem: PrismaGameSystem.SHADOWRUN_6E,
        data: toJson(sr6Sheet()),
      },
    });
    characterId = seeded.id;
  });

  afterAll(async () => {
    await prisma.characterTemplate.deleteMany({ where: { createdById: userId } });
    await prisma.character.deleteMany({
      where: { id: { in: [characterId, ...extraCharacterIds] } },
    });
    await cleanupCampaigns([untypedCampaignId, dndCampaignId, sr6CampaignId]);
    await cleanupUsers([userId, outsiderId]);
    await prisma.$disconnect();
  });

  it('GET of an existing Shadowrun Character is 200', async () => {
    const res = await agent.get(`/api/characters/${characterId}`);
    expect(res.status).toBe(200);
    expect(res.body.character.id).toBe(characterId);
    expect(res.body.character.gameSystem).toBe(GameSystem.SHADOWRUN_6E);
    expect(res.body.character.name).toBe('Existing Runner');
  });

  it('assigns into a Campaign with no game system, then unassigns', async () => {
    const assigned = await agent.post(`/api/characters/${characterId}/assign`).send({ campaignId: untypedCampaignId });
    expect(assigned.status).toBe(200);
    expect((await prisma.character.findUnique({ where: { id: characterId } }))?.campaignId).toBe(untypedCampaignId);

    const unassigned = await agent.post(`/api/characters/${characterId}/assign`).send({ campaignId: null });
    expect(unassigned.status).toBe(200);
    expect((await prisma.character.findUnique({ where: { id: characterId } }))?.campaignId).toBeNull();
  });

  it('deletes an existing Shadowrun Character', async () => {
    const doomed = await prisma.character.create({
      data: {
        userId,
        name: 'Doomed Runner',
        gameSystem: PrismaGameSystem.SHADOWRUN_6E,
        data: toJson(sr6Sheet()),
      },
    });
    extraCharacterIds.push(doomed.id);

    const res = await agent.delete(`/api/characters/${doomed.id}`);
    expect(res.status).toBe(200);
    expect(await prisma.character.findUnique({ where: { id: doomed.id } })).toBeNull();
  });

  it('POST /api/characters with gameSystem SHADOWRUN_6E is 400 with the freeze envelope', async () => {
    const before = await prisma.character.count({ where: { userId } });
    const res = await agent.post('/api/characters').send({
      name: 'New Runner',
      gameSystem: GameSystem.SHADOWRUN_6E,
      data: sr6Sheet(),
    });
    expectFrozen(res);
    expect(await prisma.character.count({ where: { userId } })).toBe(before);
    expect(await prisma.character.findFirst({ where: { userId, name: 'New Runner' } })).toBeNull();
  });

  it('create-in that inherits SHADOWRUN_6E from a Shadowrun Campaign is the same freeze', async () => {
    const before = await prisma.character.count({ where: { userId } });
    const res = await agent.post('/api/characters').send({
      name: 'Inherited Runner',
      campaignId: sr6CampaignId,
      data: sr6Sheet(),
    });
    expectFrozen(res);
    expect(await prisma.character.count({ where: { userId } })).toBe(before);
  });

  it('explicit SHADOWRUN_6E into a D&D Campaign is freeze, not mismatch', async () => {
    const res = await agent.post('/api/characters').send({
      name: 'Mismatched Runner',
      campaignId: dndCampaignId,
      gameSystem: GameSystem.SHADOWRUN_6E,
      data: sr6Sheet(),
    });
    expectFrozen(res);
    expect(res.body.error).not.toBe('Game System Mismatch');
  });

  it('PUT sheet data on an existing row is 400 and leaves stored data unchanged', async () => {
    const before = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    const res = await agent.put(`/api/characters/${characterId}`).send({
      data: { ...sr6Sheet(), characterName: 'Edited Runner' },
    });
    expectFrozen(res);
    const stored = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(stored.data).toEqual(before.data);
    expect(stored.name).toBe('Existing Runner');
  });

  it('a stranger PUT of sheet data on a frozen Character is still 403', async () => {
    const res = await outsider.put(`/api/characters/${characterId}`).send({
      data: { ...sr6Sheet(), characterName: 'Stolen' },
    });
    expect(res.status).toBe(403);
  });

  it("PUT { name: 'Renamed Runner' } without data is 200", async () => {
    const res = await agent.put(`/api/characters/${characterId}`).send({ name: 'Renamed Runner' });
    expect(res.status).toBe(200);
    expect(res.body.character.name).toBe('Renamed Runner');
    expect((await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).name).toBe('Renamed Runner');
  });

  it('tokenImageUrl-only PUT on a frozen Character is 200', async () => {
    const res = await agent.put(`/api/characters/${characterId}`).send({ tokenImageUrl: null });
    expect(res.status).toBe(200);
  });

  it('PUT that tries to change gameSystem still uses cannot-change-system 400', async () => {
    const res = await agent.put(`/api/characters/${characterId}`).send({ gameSystem: GameSystem.DND_5E });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Cannot change game system/);
    expect(res.body.code).not.toBe('GAME_SYSTEM_SHEET_FROZEN');
  });

  it('POST /api/characters/:id/copy of a Shadowrun Character is 400 and creates no row', async () => {
    const before = await prisma.character.count({ where: { userId } });
    const res = await agent.post(`/api/characters/${characterId}/copy`);
    expectFrozen(res);
    expect(await prisma.character.count({ where: { userId } })).toBe(before);
  });

  it('POST /api/character-templates with gameSystem SHADOWRUN_6E is 400 with the freeze envelope', async () => {
    const before = await prisma.characterTemplate.count({ where: { createdById: userId } });
    const res = await agent.post('/api/character-templates').send({
      name: 'Street Samurai',
      gameSystem: GameSystem.SHADOWRUN_6E,
      data: sr6Sheet(),
    });
    expectFrozen(res);
    expect(await prisma.characterTemplate.count({ where: { createdById: userId } })).toBe(before);
  });

  it('PUT sheet data on an existing Shadowrun template is 400; metadata-only PUT is 200', async () => {
    const template = await prisma.characterTemplate.create({
      data: {
        name: 'Frozen Template',
        gameSystem: PrismaGameSystem.SHADOWRUN_6E,
        data: toJson(sr6Sheet()),
        createdById: userId,
      },
    });
    const before = await prisma.characterTemplate.findUniqueOrThrow({ where: { id: template.id } });

    const dataPut = await agent.put(`/api/character-templates/${template.id}`).send({
      data: { ...sr6Sheet(), characterName: 'Edited Template' },
    });
    expectFrozen(dataPut);
    expect((await prisma.characterTemplate.findUniqueOrThrow({ where: { id: template.id } })).data).toEqual(
      before.data,
    );

    const metaPut = await agent.put(`/api/character-templates/${template.id}`).send({
      name: 'Renamed Template',
      description: 'Metadata only',
    });
    expect(metaPut.status).toBe(200);
    expect(metaPut.body.name).toBe('Renamed Template');
  });

  it('GET of a hardcoded Shadowrun starter template still works', async () => {
    const res = await agent.get('/api/characters/templates/SHADOWRUN_6E/blank');
    expect(res.status).toBe(200);
    expect(res.body.gameSystem).toBe(GameSystem.SHADOWRUN_6E);
  });

  it('a D&D create still 201', async () => {
    const res = await agent.post('/api/characters').send({
      name: 'Aldra',
      gameSystem: GameSystem.DND_5E,
      data: dndSheet(),
    });
    expect(res.status).toBe(201);
    extraCharacterIds.push(res.body.character.id as string);
    expect(res.body.character.gameSystem).toBe(GameSystem.DND_5E);
  });
});
