/**
 * After a login session is revoked, the next discrete HTTP action is 401.
 *
 * accessRevocation.e2e mocks destroyUserLoginSessions and keeps sessions in
 * memory, so it can only pin that the helper is called. This file builds
 * createApp with connect-pg-simple on the test DATABASE_URL, using the same
 * databaseConnectionSettings and schemaName as production, and observes the
 * cookie.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { Pool } from 'pg';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import request from 'supertest';
import { generateSecret, generateSync } from 'otplib';
import { createApp } from '../../app';
import { sessionOptions } from '../../config/sessionOptions';
import { databaseConnectionSettings } from '../../config/prismaClient';
import { prisma, createTestUser, cleanupUsers, TEST_PASSWORD } from '../../__tests__/helpers/db';

jest.setTimeout(60000);

const PgSession = connectPgSimple(session);
const SECRET = 'test-secret-do-not-use-in-production';

function createPgSessionApp(): {
  app: ReturnType<typeof createApp>;
  pool: Pool;
  store: InstanceType<ReturnType<typeof connectPgSimple>>;
} {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('This test needs DATABASE_URL');
  const settings = databaseConnectionSettings(url);
  const pool = new Pool(settings.pool);
  const store = new PgSession({
    pool,
    tableName: 'session',
    schemaName: settings.schema,
    createTableIfMissing: true,
  });
  const app = createApp({
    session: { ...sessionOptions, secret: SECRET, store },
    generalApiLimiter: false,
    setupGate: false,
  });
  return { app, pool, store };
}

const { app, pool, store } = createPgSessionApp();
const created: string[] = [];

async function signIn(email: string): Promise<request.Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

/** The code for `offset` steps from the step `base`. */
const codeAt = (secret: string, base: number, offset: number) =>
  generateSync({ secret, epoch: (base + offset) * 30 });

/**
 * Wait out the end of a step, so the codes a test works out stay inside the
 * server's window of one step either side for the few seconds the test runs.
 */
async function freshStep(): Promise<number> {
  const into = (Date.now() / 1000) % 30;
  if (into > 24) await new Promise((r) => setTimeout(r, (30 - into + 0.5) * 1000));
  return Math.floor(Date.now() / 1000 / 30);
}

async function signInWithMfa(email: string, token: string): Promise<request.Agent> {
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  expect(login.body.mfaRequired).toBe(true);
  const done = await agent.post('/api/auth/mfa/verify-login').send({ token });
  expect(done.status).toBe(200);
  return agent;
}

afterAll(async () => {
  await cleanupUsers(created);
  await prisma.$disconnect();
  await store.close();
  await pool.end();
});

describe('a self-service password change', () => {
  it('keeps this login session and answers 401 on the next discrete action from another cookie', async () => {
    const user = await createTestUser({ displayName: 'Revocation holder' });
    created.push(user.id);
    const agentA = await signIn(user.email);
    const agentB = await signIn(user.email);

    const changed = await agentA.post('/api/auth/change-password').send({
      currentPassword: TEST_PASSWORD,
      newPassword: 'AnotherGoodPassword123!',
    });
    expect(changed.status).toBe(200);
    expect((await agentA.get('/api/auth/me')).status).toBe(200);
    expect((await agentB.get('/api/auth/me')).status).toBe(401);
  });
});

describe('a self-service MFA change', () => {
  it('keeps this login session when MFA is turned on, and answers 401 on the other cookie', async () => {
    const user = await createTestUser({ displayName: 'MFA enable holder' });
    created.push(user.id);
    const agentA = await signIn(user.email);
    const agentB = await signIn(user.email);

    const setup = await agentA.post('/api/auth/mfa/setup').send({ password: TEST_PASSWORD });
    expect(setup.status).toBe(200);
    const token = generateSync({ secret: setup.body.secret });
    const verified = await agentA.post('/api/auth/mfa/verify').send({ token });
    expect(verified.status).toBe(200);

    expect((await agentA.get('/api/auth/me')).status).toBe(200);
    expect((await agentB.get('/api/auth/me')).status).toBe(401);
  });

  it('keeps this login session when MFA is turned off, and answers 401 on the other cookie', async () => {
    const secret = generateSecret();
    const user = await createTestUser({ displayName: 'MFA disable holder' });
    created.push(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaSecret: secret },
    });

    const base = await freshStep();
    const agentA = await signInWithMfa(user.email, codeAt(secret, base, -1));
    const agentB = await signInWithMfa(user.email, codeAt(secret, base, 0));

    const disabled = await agentA.post('/api/auth/mfa/disable').send({
      password: TEST_PASSWORD,
      token: codeAt(secret, base, 1),
    });
    expect(disabled.status).toBe(200);
    expect((await agentA.get('/api/auth/me')).status).toBe(200);
    expect((await agentB.get('/api/auth/me')).status).toBe(401);
  });
});

describe('an administrator reset', () => {
  let admin: request.Agent;

  beforeAll(async () => {
    const user = await createTestUser({ displayName: 'Revocation admin', role: 'ADMIN' });
    created.push(user.id);
    admin = await signIn(user.email);
  });

  it('kills every login session for that user, including the victim\'s cookie', async () => {
    const victim = await createTestUser({ displayName: 'Password reset victim' });
    created.push(victim.id);
    const victimAgent = await signIn(victim.email);
    const other = await signIn(victim.email);

    const res = await admin.post(`/api/users/${victim.id}/reset-password`);
    expect(res.status).toBe(200);
    expect((await victimAgent.get('/api/auth/me')).status).toBe(401);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await admin.get('/api/auth/me')).status).toBe(200);
  });

  it('kills every login session when MFA is reset, and keeps the administrator signed in', async () => {
    const victim = await createTestUser({ displayName: 'MFA reset victim' });
    created.push(victim.id);
    const victimAgent = await signIn(victim.email);
    const other = await signIn(victim.email);
    await prisma.user.update({
      where: { id: victim.id },
      data: { mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP', mfaBackupCodes: ['hash'] },
    });

    const res = await admin.post(`/api/admin/users/${victim.id}/reset-mfa`);
    expect(res.status).toBe(200);
    expect((await victimAgent.get('/api/auth/me')).status).toBe(401);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await admin.get('/api/auth/me')).status).toBe(200);
  });
});
