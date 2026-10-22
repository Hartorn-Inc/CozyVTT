/**
 * A required-name row added with no name is omitted on save, not refused.
 *
 * Spec: "Add a required-name row, save without a name: 200, the row is absent."
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, cleanupUsers, TEST_PASSWORD } from '../../__tests__/helpers/db';
import { getBlankTemplate } from '../../utils/character-templates';
import { GameSystem } from '../../game-systems';

const app = createTestApp();
let userId: string;
let agent: ReturnType<typeof request.agent>;

beforeAll(async () => {
  const u = await createTestUser({
    email: `blank-rows-${Date.now()}@test.cozyvtt.local`,
    displayName: 'Blank Rows',
  });
  userId = u.id;
  agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: u.email, password: TEST_PASSWORD })).status).toBe(200);
});

afterAll(async () => {
  await cleanupUsers([userId]);
  await prisma.$disconnect();
});

const blank = (): Record<string, unknown> => getBlankTemplate(GameSystem.DND_5E).data;

it('saves a D&D sheet that includes an unnamed attack: 200, the blank row is absent', async () => {
  const created = await agent
    .post('/api/characters')
    .send({ name: 'Blank Attack', gameSystem: 'DND_5E', data: blank() });
  expect(created.status).toBe(201);
  const id: string = created.body.character.id;

  const res = await agent.put(`/api/characters/${id}`).send({
    data: {
      ...blank(),
      attacks: [
        { name: 'Sword', attackBonus: 0 },
        { name: '' },
      ],
    },
  });
  expect(res.status).toBe(200);

  const stored = await prisma.character.findUniqueOrThrow({ where: { id } });
  const attacks = (stored.data as { attacks: Array<{ name: string }> }).attacks;
  expect(attacks).toEqual([{ name: 'Sword', attackBonus: 0 }]);
  expect(attacks.some((row) => row.name === '')).toBe(false);
});
