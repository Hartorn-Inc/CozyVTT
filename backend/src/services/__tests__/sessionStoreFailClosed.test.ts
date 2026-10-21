/**
 * Ending an account's sessions fails closed.
 *
 * The helper caught every database error, logged it and reported nothing
 * removed, and every caller ignored the count. A demotion, an admin reset or
 * a password change then reported success while the old sessions kept their
 * role until they expired. The helper now tags the failure as
 * LoginSessionStoreUnavailable, so the route answers 503 and the person is
 * told it did not take.
 */

const executeRaw = jest.fn();
jest.mock('../../config/database', () => ({
  prisma: { $executeRaw: (...args: unknown[]) => executeRaw(...args) },
}));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import session from 'express-session';
import {
  destroyUserLoginSessions,
  LoginSessionStoreUnavailable,
  LOGIN_SESSION_STORE_UNAVAILABLE_MESSAGE,
  wrapLoginSessionStore,
} from '../sessionStore';

beforeEach(() => executeRaw.mockReset());

it('reports how many sessions it removed', async () => {
  executeRaw.mockResolvedValue(3);
  await expect(destroyUserLoginSessions('u1')).resolves.toBe(3);
});

it('tags a database failure as LoginSessionStoreUnavailable instead of reporting nothing removed', async () => {
  const cause = new Error('connection terminated');
  executeRaw.mockRejectedValue(cause);
  await expect(destroyUserLoginSessions('u1')).rejects.toBeInstanceOf(LoginSessionStoreUnavailable);
  await expect(destroyUserLoginSessions('u1')).rejects.toMatchObject({
    name: 'LoginSessionStoreUnavailable',
    message: LOGIN_SESSION_STORE_UNAVAILABLE_MESSAGE,
    cause,
  });
});

it('tags a store get failure, and does not tag a missing row', async () => {
  const inner = new session.MemoryStore();
  const wrapped = wrapLoginSessionStore(inner);
  const missing = await new Promise<{ err: Error | null; sess?: session.SessionData | null }>((resolve) => {
    wrapped.get('missing', (err, sess) => resolve({ err, sess }));
  });
  expect(missing.err).toBeNull();
  expect(missing.sess).toBeUndefined();

  inner.get = (_sid, cb) => cb(new Error('ECONNREFUSED'));
  const failed = await new Promise<Error | null>((resolve) => {
    wrapped.get('missing', (err) => resolve(err));
  });
  expect(failed).toBeInstanceOf(LoginSessionStoreUnavailable);
  expect(failed?.message).toBe(LOGIN_SESSION_STORE_UNAVAILABLE_MESSAGE);
});

const idleCookie: session.SessionData = { cookie: { originalMaxAge: 60_000 } };

it('tags a store touch callback failure so rolling idle HTTP is 503, not 500', async () => {
  const inner = new session.MemoryStore();
  inner.touch = (_sid, _sess, cb) => {
    if (cb) Reflect.apply(cb, undefined, [new Error('ECONNREFUSED')]);
  };
  const wrapped = wrapLoginSessionStore(inner);
  const failed = await new Promise<Error | undefined>((resolve) => {
    wrapped.touch('sid', idleCookie, (err?: Error) => resolve(err));
  });
  expect(failed).toBeInstanceOf(LoginSessionStoreUnavailable);
  expect(failed?.message).toBe(LOGIN_SESSION_STORE_UNAVAILABLE_MESSAGE);
});

it('tags a thrown store touch failure', async () => {
  const inner = new session.MemoryStore();
  inner.touch = () => {
    throw new Error('ECONNREFUSED');
  };
  const wrapped = wrapLoginSessionStore(inner);
  const failed = await new Promise<Error | undefined>((resolve) => {
    wrapped.touch('sid', idleCookie, (err?: Error) => resolve(err));
  });
  expect(failed).toBeInstanceOf(LoginSessionStoreUnavailable);
  expect(failed?.message).toBe(LOGIN_SESSION_STORE_UNAVAILABLE_MESSAGE);
});
