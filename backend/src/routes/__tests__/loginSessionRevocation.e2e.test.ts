/**
 * Ending a login session is visible on the next HTTP request that uses it.
 *
 * The test app keeps sessions in memory, so the other e2e files can only pin
 * that revocation *calls* the helper. This file builds the app with the
 * production PostgreSQL store (config/session.ts) and two cookies for one
 * account: after a self-service password change the device that made it stays
 * signed in and the other cookie's next discrete action is 401; after an
 * administrator reset, both are 401 and the password has changed.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { createHmac } from 'crypto';
import request from 'supertest';
import { generateSync } from 'otplib';
import type session from 'express-session';
import { createApp } from '../../app';
import { loginSessionRevocationGuard, loginSessionWriteBarrier, sessionConfig, sessionPool } from '../../config/session';
import { LOGIN_SESSION_SID_LOCK, LOGIN_SESSION_USER_LOCK, writeLoginSessionUnlessRevoked } from '../../config/loginSessionRevocationGuard';
import { destroyUserLoginSessions, destroyUserLoginSessionsBarrier } from '../../services/sessionStore';
import { deleteAccount } from '../../services/accountDeletion';
import { mfaVerifyLoginBarrier } from '../auth';
import {
  prisma,
  createTestUser,
  cleanupUsers,
  TEST_PASSWORD,
} from '../../__tests__/helpers/db';

jest.setTimeout(60_000);

const app = createApp({
  session: sessionConfig,
  generalApiLimiter: false,
  setupGate: false,
});

const NEW_PASSWORD = 'AnotherGoodPassword123!';
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const created: string[] = [];

async function signIn(email: string, password = TEST_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return agent;
}

/** The session id a response's cookie names, decoded from `s:<sid>.<signature>`. */
function sidOf(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.map((c) => c.split(';')[0]).find((c) => c.startsWith('cozyvtt.sid='));
  if (!cookie) throw new Error('no session cookie was set');
  return decodeURIComponent(cookie.slice('cozyvtt.sid='.length)).slice(2).split('.')[0];
}

function cookieFor(sid: string): string {
  const secret = sessionConfig.secret;
  const key = Array.isArray(secret) ? secret[0] : secret;
  if (typeof key !== 'string') throw new Error('session secret was not a string');
  const sig = createHmac('sha256', key).update(sid).digest('base64').replace(/=+$/g, '');
  return `cozyvtt.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

function cookieOf(sess: Partial<session.SessionData> = {}): session.SessionData {
  return {
    cookie: {
      originalMaxAge: 3_600_000,
      expires: new Date(Date.now() + 3_600_000),
      httpOnly: true,
      path: '/',
    },
    ...sess,
  };
}

function storeGet(sid: string): Promise<session.SessionData | null | undefined> {
  const store = sessionConfig.store;
  if (!store) throw new Error('the session store was not configured');
  return new Promise((resolve, reject) => {
    store.get(sid, (err, sess) => {
      if (err) reject(err);
      else resolve(sess);
    });
  });
}

function storeSet(sid: string, sess: session.SessionData): Promise<void> {
  const store = sessionConfig.store;
  if (!store) throw new Error('the session store was not configured');
  return new Promise((resolve, reject) => {
    store.set(sid, sess, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** A code from a step that enrolment has not already spent. */
async function nextUnusedTotp(secret: string): Promise<string> {
  const into = (Date.now() / 1000) % 30;
  await new Promise((r) => setTimeout(r, (30 - into + 0.5) * 1000));
  return generateSync({ secret });
}

async function signInWithBackup(email: string, backupCode: string) {
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  expect(login.body.mfaRequired).toBe(true);
  const done = await agent.post('/api/auth/mfa/verify-login').send({ backupCode });
  expect(done.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  await loginSessionRevocationGuard;
});

afterEach(() => {
  delete loginSessionWriteBarrier.wait;
  delete mfaVerifyLoginBarrier.wait;
  delete mfaVerifyLoginBarrier.reached;
  delete destroyUserLoginSessionsBarrier.wait;
  delete destroyUserLoginSessionsBarrier.reached;
});

afterAll(async () => {
  await cleanupUsers(created);
  await prisma.$disconnect();
  if (!sessionPool.ending) await sessionPool.end();
});

describe('a self-service password change', () => {
  it('keeps this login session and answers 401 to the other cookie\'s next action', async () => {
    const user = await createTestUser({ email: `pg-store-change-${stamp}@test.cozyvtt.local` });
    created.push(user.id);
    const kept = await signIn(user.email);
    const other = await signIn(user.email);

    const change = await kept.post('/api/auth/change-password').send({
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(change.status).toBe(200);

    expect((await kept.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });
});

describe('an administrator password reset', () => {
  it('answers 401 to both of the target\'s cookies, and the password mutation succeeded', async () => {
    const admin = await createTestUser({
      email: `pg-store-admin-${stamp}@test.cozyvtt.local`,
      role: 'ADMIN',
    });
    const target = await createTestUser({ email: `pg-store-reset-${stamp}@test.cozyvtt.local` });
    created.push(admin.id, target.id);
    const first = await signIn(target.email);
    const second = await signIn(target.email);
    const asAdmin = await signIn(admin.email);

    const reset = await asAdmin.post(`/api/users/${target.id}/reset-password`);
    expect(reset.status).toBe(200);
    expect(typeof reset.body.temporaryPassword).toBe('string');

    expect((await first.get('/api/auth/me')).status).toBe(401);
    expect((await second.get('/api/auth/me')).status).toBe(401);

    const withNew = await signIn(target.email, reset.body.temporaryPassword);
    expect((await withNew.get('/api/auth/me')).status).toBe(200);
  });
});

describe('self-service MFA enable', () => {
  it('keeps this login session and answers 401 to the other cookie\'s next action', async () => {
    const user = await createTestUser({ email: `pg-store-mfa-on-${stamp}@test.cozyvtt.local` });
    created.push(user.id);
    const kept = await signIn(user.email);
    const other = await signIn(user.email);

    const setup = await kept.post('/api/auth/mfa/setup').send({ password: TEST_PASSWORD });
    expect(setup.status).toBe(200);
    const verify = await kept.post('/api/auth/mfa/verify').send({
      token: generateSync({ secret: setup.body.secret }),
    });
    expect(verify.status).toBe(200);

    expect((await kept.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });
});

describe('self-service MFA disable', () => {
  it('keeps this login session and answers 401 to the other cookie\'s next action', async () => {
    const user = await createTestUser({ email: `pg-store-mfa-off-${stamp}@test.cozyvtt.local` });
    created.push(user.id);
    const enrol = await signIn(user.email);
    const setup = await enrol.post('/api/auth/mfa/setup').send({ password: TEST_PASSWORD });
    expect(setup.status).toBe(200);
    const secret: string = setup.body.secret;
    const enabled = await enrol.post('/api/auth/mfa/verify').send({
      token: generateSync({ secret }),
    });
    expect(enabled.status).toBe(200);
    const codes: string[] = enabled.body.backupCodes;

    const kept = await signInWithBackup(user.email, codes[0]);
    const other = await signInWithBackup(user.email, codes[1]);

    const off = await kept.post('/api/auth/mfa/disable').send({
      password: TEST_PASSWORD,
      token: await nextUnusedTotp(secret),
    });
    expect(off.status).toBe(200);

    expect((await kept.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });
});

describe('an administrator MFA reset', () => {
  it('answers 401 to both of the target\'s cookies, and MFA is off', async () => {
    const admin = await createTestUser({
      email: `pg-store-mfa-admin-${stamp}@test.cozyvtt.local`,
      role: 'ADMIN',
    });
    const target = await createTestUser({ email: `pg-store-mfa-reset-${stamp}@test.cozyvtt.local` });
    created.push(admin.id, target.id);

    const enrol = await signIn(target.email);
    const setup = await enrol.post('/api/auth/mfa/setup').send({ password: TEST_PASSWORD });
    expect(setup.status).toBe(200);
    const enabled = await enrol.post('/api/auth/mfa/verify').send({
      token: generateSync({ secret: setup.body.secret }),
    });
    expect(enabled.status).toBe(200);
    const codes: string[] = enabled.body.backupCodes;

    const first = await signInWithBackup(target.email, codes[0]);
    const second = await signInWithBackup(target.email, codes[1]);
    const asAdmin = await signIn(admin.email);

    const reset = await asAdmin.post(`/api/admin/users/${target.id}/reset-mfa`);
    expect(reset.status).toBe(200);

    expect((await first.get('/api/auth/me')).status).toBe(401);
    expect((await second.get('/api/auth/me')).status).toBe(401);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(stored.mfaEnabled).toBe(false);
    expect(stored.mfaSecret).toBeNull();
  });
});

describe('an in-flight store.set after destroy', () => {
  it('does not resurrect the deleted login session on the next HTTP action', async () => {
    const user = await createTestUser({ email: `pg-store-resurrect-${stamp}@test.cozyvtt.local` });
    created.push(user.id);
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const sid = sidOf(login);
    const sess = await storeGet(sid);
    expect(sess?.userId).toBe(user.id);
    if (!sess) throw new Error('expected a stored session');

    expect(await destroyUserLoginSessions(user.id)).toBe(1);
    await storeSet(sid, sess);

    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('does not recreate the row when set passed the in-memory check before destroy committed', async () => {
    const user = await createTestUser({ email: `pg-store-race-${stamp}@test.cozyvtt.local` });
    created.push(user.id);
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const sid = sidOf(login);
    const sess = await storeGet(sid);
    expect(sess?.userId).toBe(user.id);
    if (!sess) throw new Error('expected a stored session');

    let release!: () => void;
    loginSessionWriteBarrier.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = storeSet(sid, sess);
    expect(await destroyUserLoginSessions(user.id)).toBe(1);
    release();
    await pending;

    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const rows = await prisma.$queryRaw<{ sid: string }[]>`SELECT sid FROM session WHERE sid = ${sid}`;
    expect(rows).toEqual([]);
  });

  it('does not leave the row when set and destroy run together', async () => {
    const user = await createTestUser({ email: `pg-store-all-${stamp}@test.cozyvtt.local` });
    created.push(user.id);
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const sid = sidOf(login);
    const sess = await storeGet(sid);
    expect(sess?.userId).toBe(user.id);
    if (!sess) throw new Error('expected a stored session');

    await Promise.all([storeSet(sid, sess), destroyUserLoginSessions(user.id)]);

    const rows = await prisma.$queryRaw<{ sid: string }[]>`SELECT sid FROM session WHERE sid = ${sid}`;
    expect(rows).toEqual([]);
  });

  it('does not leave the row when a third connection holds the advisory lock across write and destroy', async () => {
    const user = await createTestUser({ email: `pg-store-lock-${stamp}@test.cozyvtt.local` });
    created.push(user.id);
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const sid = sidOf(login);
    const sess = await storeGet(sid);
    expect(sess?.userId).toBe(user.id);
    if (!sess) throw new Error('expected a stored session');

    const holder = await sessionPool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        `SELECT pg_advisory_xact_lock(${LOGIN_SESSION_USER_LOCK}, hashtext($1::text))`,
        [user.id],
      );
      await holder.query(
        `SELECT pg_advisory_xact_lock(${LOGIN_SESSION_SID_LOCK}, hashtext($1::text))`,
        [sid],
      );

      const write = writeLoginSessionUnlessRevoked(sessionPool, sid, sess);
      await waitForAdvisoryWaiters(LOGIN_SESSION_USER_LOCK, user.id, 1);
      const destroy = destroyUserLoginSessions(user.id);
      await waitForAdvisoryWaiters(LOGIN_SESSION_USER_LOCK, user.id, 2);
      await holder.query('COMMIT');
      await Promise.all([write, destroy]);
    } finally {
      holder.release();
    }

    const rows = await prisma.$queryRaw<{ sid: string }[]>`SELECT sid FROM session WHERE sid = ${sid}`;
    expect(rows).toEqual([]);
  });

  it('does not authenticate a new sid whose store.set ran after destroy committed', async () => {
    const user = await createTestUser({ email: `pg-store-new-sid-${stamp}@test.cozyvtt.local` });
    created.push(user.id);
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const sid = sidOf(login);
    const sess = await storeGet(sid);
    expect(sess?.userId).toBe(user.id);
    expect(sess?.loginSessionEpoch).toBe(0);
    if (!sess) throw new Error('expected a stored session');

    const newSid = `new-sid-${stamp}`;
    let release!: () => void;
    loginSessionWriteBarrier.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = storeSet(newSid, sess);
    expect(await destroyUserLoginSessions(user.id)).toBe(1);
    release();
    await pending;

    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const rows = await prisma.$queryRaw<{ sid: string }[]>`SELECT sid FROM session WHERE sid = ${newSid}`;
    expect(rows).toEqual([]);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookieFor(newSid))).status).toBe(401);
  });

  it('increments epoch when the user has no sessions, so a new sid stamped with the old epoch does not insert', async () => {
    const user = await createTestUser({ email: `pg-store-zero-${stamp}@test.cozyvtt.local` });
    created.push(user.id);
    expect(user.loginSessionEpoch).toBe(0);
    expect(await destroyUserLoginSessions(user.id)).toBe(0);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.loginSessionEpoch).toBe(1);

    const newSid = `new-sid-zero-${stamp}`;
    await writeLoginSessionUnlessRevoked(sessionPool, newSid, cookieOf({
      userId: user.id,
      loginSessionEpoch: 0,
    }));
    const rows = await prisma.$queryRaw<{ sid: string }[]>`SELECT sid FROM session WHERE sid = ${newSid}`;
    expect(rows).toEqual([]);
  });
});

describe('a login-session row committed after a SERIALIZABLE snapshot', () => {
  async function insertRacedSid(sid: string, userId: string, platformRole: 'USER' | 'ADMIN') {
    await prisma.$executeRaw`
      INSERT INTO session (sid, sess, expire)
      VALUES (
        ${sid},
        ${JSON.stringify({
          cookie: {
            originalMaxAge: 3_600_000,
            expires: new Date(Date.now() + 3_600_000),
            httpOnly: true,
            path: '/',
          },
          userId,
          platformRole,
          signedInAt: Date.now(),
          loginSessionEpoch: 0,
        })}::json,
        NOW() + interval '1 hour'
      )
    `;
  }

  it('is gone after account deletion, and the next HTTP request is 401', async () => {
    const user = await createTestUser({ email: `pg-store-serializable-delete-${stamp}@test.cozyvtt.local` });
    created.push(user.id);
    const racedSid = `raced-delete-${stamp}`;

    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      destroyUserLoginSessionsBarrier.reached = resolve;
    });
    destroyUserLoginSessionsBarrier.wait = new Promise<void>((resolve) => {
      release = resolve;
    });

    const deletion = deleteAccount(user.id);
    await reached;
    await insertRacedSid(racedSid, user.id, 'USER');
    release();
    const result = await deletion;
    expect(result.deleted).toBe(true);

    const rows = await prisma.$queryRaw<{ sid: string }[]>`SELECT sid FROM session WHERE sid = ${racedSid}`;
    expect(rows).toEqual([]);
    // ping is requireAuth only: /me re-reads User and would 401 because the
    // account is gone even if this sid had survived.
    expect((await request(app).get('/api/auth/ping').set('Cookie', cookieFor(racedSid))).status).toBe(401);
  });

  it('is gone after demotion to USER, and the next HTTP request is 401', async () => {
    const admin = await createTestUser({
      email: `pg-store-serializable-demote-admin-${stamp}@test.cozyvtt.local`,
      role: 'ADMIN',
    });
    const target = await createTestUser({
      email: `pg-store-serializable-demote-target-${stamp}@test.cozyvtt.local`,
      role: 'ADMIN',
    });
    created.push(admin.id, target.id);
    const asAdmin = await signIn(admin.email);
    const racedSid = `raced-demote-${stamp}`;

    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      destroyUserLoginSessionsBarrier.reached = resolve;
    });
    destroyUserLoginSessionsBarrier.wait = new Promise<void>((resolve) => {
      release = resolve;
    });

    const demotion = Promise.resolve(asAdmin.put(`/api/users/${target.id}`).send({ platformRole: 'USER' }));
    await reached;
    await insertRacedSid(racedSid, target.id, 'USER');
    release();
    const res = await demotion;
    expect(res.status).toBe(200);

    const rows = await prisma.$queryRaw<{ sid: string }[]>`SELECT sid FROM session WHERE sid = ${racedSid}`;
    expect(rows).toEqual([]);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookieFor(racedSid))).status).toBe(401);
  });
});

describe('an in-flight MFA verify-login after destroy', () => {
  it('does not complete sign-in when destroy increments epoch before the User re-read', async () => {
    const user = await createTestUser({ email: `pg-store-mfa-verify-race-${stamp}@test.cozyvtt.local` });
    created.push(user.id);
    const enrol = await signIn(user.email);
    const setup = await enrol.post('/api/auth/mfa/setup').send({ password: TEST_PASSWORD });
    expect(setup.status).toBe(200);
    const secret: string = setup.body.secret;
    const enabled = await enrol.post('/api/auth/mfa/verify').send({
      token: generateSync({ secret }),
    });
    expect(enabled.status).toBe(200);

    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.mfaRequired).toBe(true);

    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      mfaVerifyLoginBarrier.reached = resolve;
    });
    mfaVerifyLoginBarrier.wait = new Promise<void>((resolve) => {
      release = resolve;
    });

    const token = await nextUnusedTotp(secret);
    const finished = Promise.resolve(agent.post('/api/auth/mfa/verify-login').send({ token }));
    await reached;
    await destroyUserLoginSessions(user.id);
    release();
    const verify = await finished;
    expect(verify.status).toBe(401);

    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const rows = await prisma.$queryRaw<{ sid: string }[]>`
      SELECT sid FROM session WHERE sess->>'userId' = ${user.id}
    `;
    expect(rows).toEqual([]);
  });
});

async function waitForAdvisoryWaiters(classid: number, key: string, atLeast: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await sessionPool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM pg_locks
        WHERE locktype = 'advisory'
          AND objsubid = 2
          AND classid = $1
          AND objid = hashtext($2::text)::oid
          AND NOT granted`,
      [classid, key],
    );
    if (waiting.rows[0].n >= atLeast) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${atLeast} advisory lock waiter(s)`);
}

