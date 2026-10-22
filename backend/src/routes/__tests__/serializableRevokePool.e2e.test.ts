/**
 * Serializable account deletion and USER demotion revoke login sessions at
 * Prisma `connection_limit=1`.
 *
 * inSerializableTransaction holds the singleton Prisma pool's only
 * connection for the whole callback. Session-row DELETE at Read Committed
 * must use the session-store pool, not a second Prisma checkout: that wait
 * is CONNECT_TIMEOUT_MS (5s) and the account change would answer 503.
 *
 * Isolated schema, production PostgreSQL session store, sequential cases
 * only. Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
import type express from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import type session from 'express-session';
import { createIsolatedSchema, type IsolatedSchema } from '../../__tests__/helpers/isolatedSchema';
import { createPrismaClient } from '../../config/prismaClient';

jest.setTimeout(30000);

const PASSWORD = 'SerializablePool1!Cozy';
const sharedUrl = process.env.DATABASE_URL;

let schema: IsolatedSchema;
let db: PrismaClient;
let app: express.Express;
let sessionPool: Pool;
let sessionConfig: session.SessionOptions;
let hashPassword: (password: string) => Promise<string>;

beforeAll(async () => {
  schema = createIsolatedSchema('serializable_revoke_pool_test');
  const address = new URL(schema.url);
  address.searchParams.set('connection_limit', '1');
  const urlWithLimit1 = address.toString();
  process.env.DATABASE_URL = urlWithLimit1;

  db = createPrismaClient(urlWithLimit1);
  (global as unknown as { prisma?: PrismaClient }).prisma = db;

  const sessionMod = require('../../config/session') as typeof import('../../config/session');
  sessionPool = sessionMod.sessionPool;
  sessionConfig = sessionMod.sessionConfig;
  await sessionMod.loginSessionRevocationGuard;

  ({ hashPassword } = require('../../services/auth') as typeof import('../../services/auth'));
  const { createApp } = require('../../app') as typeof import('../../app');
  app = createApp({
    session: sessionConfig,
    generalApiLimiter: false,
    setupGate: false,
  });
});

afterAll(async () => {
  if (!sessionPool.ending) await sessionPool.end();
  await db.$disconnect();
  schema.drop();
  process.env.DATABASE_URL = sharedUrl;
});

async function createUser(name: string, role: 'USER' | 'ADMIN') {
  const passwordHash = await hashPassword(PASSWORD);
  return db.user.create({
    data: {
      email: `${name}@pool.test`,
      displayName: name,
      passwordHash,
      platformRole: role,
    },
  });
}

async function signIn(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

async function sessionSidsFor(userId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ sid: string }[]>`
    SELECT sid FROM session WHERE sess->>'userId' = ${userId} ORDER BY sid
  `;
  return rows.map((row) => row.sid);
}

it('deletes a USER account at Prisma connection_limit=1 and the next cookie action is 401', async () => {
  const user = await createUser('lea', 'USER');
  const agent = await signIn(user.email);
  expect(await sessionSidsFor(user.id)).toHaveLength(1);

  const deletion = await agent.delete('/api/auth/account').send({ password: PASSWORD });
  expect(deletion.status).toBe(200);
  expect(deletion.status).not.toBe(503);

  expect(await sessionSidsFor(user.id)).toEqual([]);
  expect((await agent.get('/api/auth/ping')).status).toBe(401);
});

it('demotes a second ADMIN to USER at Prisma connection_limit=1 and the next /me is 401', async () => {
  await db.user.deleteMany({});
  const admin = await createUser('ada', 'ADMIN');
  const target = await createUser('bea', 'ADMIN');
  const asAdmin = await signIn(admin.email);
  const asTarget = await signIn(target.email);
  expect(await sessionSidsFor(target.id)).toHaveLength(1);

  const demotion = await asAdmin.put(`/api/users/${target.id}`).send({ platformRole: 'USER' });
  expect(demotion.status).toBe(200);
  expect(demotion.status).not.toBe(503);

  expect(await sessionSidsFor(target.id)).toEqual([]);
  expect((await asTarget.get('/api/auth/me')).status).toBe(401);
});
