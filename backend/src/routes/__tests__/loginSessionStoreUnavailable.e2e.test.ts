/**
 * When the login-session store cannot be confirmed, HTTP fails closed with 503.
 *
 * A store get error on an authenticated-looking request must not be 401 (as a
 * missing session is), 200, or 500. A destroyUserLoginSessions failure on
 * change-password or an admin MFA reset must not persist the mutation.
 *
 * Mocks sessionStore the way accessRevocation.e2e does, in this dedicated
 * file, so the real-store revocation tests keep a live destroy.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import session from 'express-session';
import request from 'supertest';

jest.mock('../../services/sessionStore', () => {
  const actual = jest.requireActual<typeof import('../../services/sessionStore')>('../../services/sessionStore');
  return {
    ...actual,
    destroyUserLoginSessions: jest.fn(async () => {
      throw new actual.LoginSessionStoreUnavailable(new Error('connection terminated'));
    }),
    capLoginSessions: jest.fn(async () => 0),
  };
});

import { createApp } from '../../app';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { sessionOptions } from '../../config/sessionOptions';
import {
  LOGIN_SESSION_STORE_UNAVAILABLE_BODY,
  destroyUserLoginSessions,
} from '../../services/sessionStore';
import { prisma, createTestUser, cleanupUsers, TEST_PASSWORD } from '../../__tests__/helpers/db';

jest.setTimeout(30000);

const app = createTestApp();
const created: string[] = [];
const destroyed = jest.mocked(destroyUserLoginSessions);

async function signIn(email: string, target: ReturnType<typeof createTestApp> = app): Promise<request.Agent> {
  const agent = request.agent(target);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

beforeEach(() => destroyed.mockClear());

afterAll(async () => {
  await cleanupUsers(created);
  await prisma.$disconnect();
});

describe('a session store get that errors', () => {
  it('answers 503 on the next discrete authenticated action, not 401, 200, or 500', async () => {
    const inner = new session.MemoryStore();
    const storeApp = createApp({
      session: { ...sessionOptions, secret: 'test-secret-do-not-use-in-production', store: inner },
      generalApiLimiter: false,
      setupGate: false,
    });
    const user = await createTestUser({ displayName: 'Store get user' });
    created.push(user.id);
    const agent = await signIn(user.email, storeApp);
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    inner.get = (_sid, cb) => cb(new Error('ECONNREFUSED'));
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(503);
    expect(res.body).toEqual(LOGIN_SESSION_STORE_UNAVAILABLE_BODY);
  });

  it('answers 401 when the cookie is present but the row is gone, not 503', async () => {
    const inner = new session.MemoryStore();
    const storeApp = createApp({
      session: { ...sessionOptions, secret: 'test-secret-do-not-use-in-production', store: inner },
      generalApiLimiter: false,
      setupGate: false,
    });
    const user = await createTestUser({ displayName: 'Revoked empty session' });
    created.push(user.id);
    const agent = await signIn(user.email, storeApp);
    inner.get = (_sid, cb) => cb(null, null);
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });
});

describe('a mutation whose revocation cannot be confirmed', () => {
  it('answers 503 on change-password and does not persist the new password', async () => {
    const user = await createTestUser({ displayName: 'Password 503' });
    created.push(user.id);
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    const agent = await signIn(user.email);

    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: TEST_PASSWORD,
      newPassword: 'AnotherGoodPassword123!',
    });
    expect(res.status).toBe(503);
    expect(res.body).toEqual(LOGIN_SESSION_STORE_UNAVAILABLE_BODY);
    expect(destroyed).toHaveBeenCalled();

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('answers 503 on admin MFA reset and does not clear MFA', async () => {
    const admin = await createTestUser({ displayName: 'MFA 503 admin', role: 'ADMIN' });
    const target = await createTestUser({ displayName: 'MFA 503 target' });
    created.push(admin.id, target.id);
    await prisma.user.update({
      where: { id: target.id },
      data: { mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP', mfaBackupCodes: ['hash'] },
    });
    const agent = await signIn(admin.email);

    const res = await agent.post(`/api/admin/users/${target.id}/reset-mfa`);
    expect(res.status).toBe(503);
    expect(res.body).toEqual(LOGIN_SESSION_STORE_UNAVAILABLE_BODY);
    expect(destroyed).toHaveBeenCalledWith(target.id, undefined, expect.anything());

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { mfaEnabled: true, mfaSecret: true },
    });
    expect(stored.mfaEnabled).toBe(true);
    expect(stored.mfaSecret).toBe('JBSWY3DPEHPK3PXP');
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });
});
