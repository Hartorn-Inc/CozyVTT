/**
 * Custom header colours that fail 4.5:1 against #FFFFFF are refused on write.
 * Presets still save. An already-stored pale colour still loads; the next
 * save is 400 until it is a passing hex or a preset.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, cleanupUsers, TEST_PASSWORD } from '../../__tests__/helpers/db';
import { getBlankTemplate } from '../../utils/character-templates';
import { GameSystem } from '../../game-systems';
import { toJson } from '../../utils/prisma-json';
import { PALE_HEADER_COLOUR_MESSAGE } from '../../validators/game-systems/sheetChrome';

const app = createTestApp();
let userId: string;
let agent: ReturnType<typeof request.agent>;

beforeAll(async () => {
  const u = await createTestUser({
    email: `header-colour-${Date.now()}@test.cozyvtt.local`,
    displayName: 'Header Colour',
  });
  userId = u.id;
  agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: u.email, password: TEST_PASSWORD })).status).toBe(200);
});

afterAll(async () => {
  await cleanupUsers([userId]);
  await prisma.$disconnect();
});

const systems: Array<{ label: string; gameSystem: GameSystem; preset: string }> = [
  { label: 'D&D 5e', gameSystem: GameSystem.DND_5E, preset: 'Classic Red' },
  { label: 'Pathfinder 2e', gameSystem: GameSystem.PATHFINDER_2E, preset: 'Golden' },
  { label: 'Call of Cthulhu 7e', gameSystem: GameSystem.CALL_OF_CTHULHU_7E, preset: 'Dark Forest' },
];

function blank(system: GameSystem): Record<string, unknown> {
  return getBlankTemplate(system).data;
}

describe.each(systems)('$label header colour', ({ gameSystem, preset }) => {
  it('refuses custom header #FFFF00 with 400', async () => {
    const created = await agent
      .post('/api/characters')
      .send({ name: `${gameSystem} pale`, gameSystem, data: blank(gameSystem) });
    expect(created.status).toBe(201);
    const id: string = created.body.character.id;

    const res = await agent.put(`/api/characters/${id}`).send({
      data: { ...blank(gameSystem), themeColor: '#FFFF00' },
    });
    expect(res.status).toBe(400);
    expect(res.body.validationErrors?.map((issue: { message: string }) => issue.message)).toContain(
      PALE_HEADER_COLOUR_MESSAGE
    );
  });

  it('saves a preset header theme with 200', async () => {
    const created = await agent
      .post('/api/characters')
      .send({ name: `${gameSystem} preset`, gameSystem, data: blank(gameSystem) });
    expect(created.status).toBe(201);
    const id: string = created.body.character.id;

    const res = await agent.put(`/api/characters/${id}`).send({
      data: { ...blank(gameSystem), themeColor: preset },
    });
    expect(res.status).toBe(200);
    const stored = await prisma.character.findUniqueOrThrow({ where: { id } });
    expect((stored.data as { themeColor: string }).themeColor).toBe(preset);
  });
});

it('returns an already-stored #FFFF00 on GET, and refuses the next PUT until it is corrected', async () => {
  const created = await agent
    .post('/api/characters')
    .send({ name: 'Stored pale', gameSystem: 'DND_5E', data: blank(GameSystem.DND_5E) });
  expect(created.status).toBe(201);
  const id: string = created.body.character.id;

  const sheet = { ...blank(GameSystem.DND_5E), themeColor: '#FFFF00' };
  await prisma.character.update({ where: { id }, data: { data: toJson(sheet) } });

  const got = await agent.get(`/api/characters/${id}`);
  expect(got.status).toBe(200);
  expect(got.body.character.data.themeColor).toBe('#FFFF00');

  const refused = await agent.put(`/api/characters/${id}`).send({ data: sheet });
  expect(refused.status).toBe(400);

  const corrected = await agent.put(`/api/characters/${id}`).send({
    data: { ...blank(GameSystem.DND_5E), themeColor: '#b91c1c' },
  });
  expect(corrected.status).toBe(200);
});
