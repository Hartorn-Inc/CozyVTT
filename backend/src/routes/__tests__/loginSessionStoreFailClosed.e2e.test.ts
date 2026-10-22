/**
 * A credential change that cannot revoke login sessions is 503, and is not kept.
 *
 * The password or MFA used to be written first and the sessions ended after.
 * If the DELETE failed, the route answered 500 with the new password already
 * stored, and the other devices kept acting. The row change and the DELETE
 * are one Prisma transaction; a store failure rolls both back and the error
 * handler answers 503 Service Unavailable.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

jest.mock('../../services/sessionStore', () => {
  const actual = jest.requireActual('../../services/sessionStore') as typeof import('../../services/sessionStore');
  return {
    ...actual,
    destroyUserLoginSessions: jest.fn(async () => 1),
    capLoginSessions: jest.fn(async () => 0),
  };
});

import request from 'supertest';
import { createTestApp } from '../../__tests__/helpers/test-app';
import {
  destroyUserLoginSessions,
  LoginSessionStoreUnavailable,
} from '../../services/sessionStore';
import {
  prisma,
  createTestUser,
  cleanupUsers,
  TEST_PASSWORD,
} from '../../__tests__/helpers/db';

const app = createTestApp();
const destroyed = destroyUserLoginSessions as jest.MockedFunction<typeof destroyUserLoginSessions>;
const NEW_PASSWORD = 'AnotherGoodPassword123!';
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const created: string[] = [];

async function signIn(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

beforeEach(() => {
  destroyed.mockReset();
  destroyed.mockResolvedValue(1);
});

afterAll(async () => {
  await cleanupUsers(created);
  await prisma.$disconnect();
});

describe('POST /api/auth/change-password', () => {
  it('answers 503 Service Unavailable and leaves the password unchanged when revocation fails', async () => {
    const user = await createTestUser({ email: `fail-closed-change-${stamp}@test.cozyvtt.local` });
    created.push(user.id);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const agent = await signIn(user.email);

    destroyed.mockRejectedValueOnce(new LoginSessionStoreUnavailable());
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: 'Service Unavailable',
      message: 'The login session could not be confirmed. Try again in a moment.',
    });
    expect(res.headers['retry-after']).toBeUndefined();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });
});

describe('POST /api/admin/users/:id/reset-mfa', () => {
  it('answers 503 Service Unavailable and leaves MFA on when revocation fails', async () => {
    const admin = await createTestUser({
      email: `fail-closed-admin-${stamp}@test.cozyvtt.local`,
      role: 'ADMIN',
    });
    const target = await createTestUser({ email: `fail-closed-mfa-${stamp}@test.cozyvtt.local` });
    created.push(admin.id, target.id);
    await prisma.user.update({
      where: { id: target.id },
      data: { mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP', mfaBackupCodes: ['hash'] },
    });
    const asAdmin = await signIn(admin.email);

    destroyed.mockRejectedValueOnce(new LoginSessionStoreUnavailable());
    const res = await asAdmin.post(`/api/admin/users/${target.id}/reset-mfa`);

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Service Unavailable');
    expect(res.body.message).toBe('The login session could not be confirmed. Try again in a moment.');

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(stored.mfaEnabled).toBe(true);
    expect(stored.mfaSecret).toBe('JBSWY3DPEHPK3PXP');
  });
});
