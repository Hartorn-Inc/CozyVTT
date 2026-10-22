/**
 * Ending an account's sessions fails closed.
 *
 * The helper caught every database error, logged it and reported nothing
 * removed, and every caller ignored the count. A demotion, an admin reset or
 * a password change then reported success while the old sessions kept their
 * role until they expired. The helper now wraps a store failure as
 * LoginSessionStoreUnavailable, so the route answers 503 and the person is
 * told it did not take.
 */

const queryRaw = jest.fn();
jest.mock('../../config/database', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    $transaction: (work: (tx: { $queryRaw: (...args: unknown[]) => unknown }) => Promise<unknown>) =>
      work({ $queryRaw: (...args: unknown[]) => queryRaw(...args) }),
  },
}));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const revoked = jest.requireActual('../revokedLoginSessions') as typeof import('../revokedLoginSessions');
const blockLoginSessions = jest.fn((sids: readonly string[]) => {
  revoked.blockLoginSessions(sids);
});
jest.mock('../revokedLoginSessions', () => {
  const actual = jest.requireActual('../revokedLoginSessions') as typeof import('../revokedLoginSessions');
  return {
    ...actual,
    blockLoginSessions: (sids: readonly string[]) => blockLoginSessions(sids),
  };
});

import { destroyUserLoginSessions, LoginSessionStoreUnavailable } from '../sessionStore';
import { isLoginSessionBlocked } from '../revokedLoginSessions';

beforeEach(() => {
  queryRaw.mockReset();
  blockLoginSessions.mockReset();
  blockLoginSessions.mockImplementation((sids: readonly string[]) => {
    revoked.blockLoginSessions(sids);
  });
});

it('reports how many sessions it removed', async () => {
  queryRaw.mockResolvedValue([{ sid: 'a' }, { sid: 'b' }, { sid: 'c' }]);
  await expect(destroyUserLoginSessions('u1')).resolves.toBe(3);
});

it('wraps a database failure as LoginSessionStoreUnavailable rather than reporting nothing removed', async () => {
  queryRaw.mockRejectedValue(new Error('connection terminated'));
  await expect(destroyUserLoginSessions('u1')).rejects.toBeInstanceOf(LoginSessionStoreUnavailable);
  await expect(destroyUserLoginSessions('u1')).rejects.toThrow(
    'The login session could not be confirmed. Try again in a moment.'
  );
});

it('blocks the deleted sids and not the session it is asked to keep', async () => {
  queryRaw.mockResolvedValue([{ sid: 'gone-one' }, { sid: 'gone-two' }]);
  await destroyUserLoginSessions('u1', 'kept-sid');
  expect(isLoginSessionBlocked('gone-one')).toBe(true);
  expect(isLoginSessionBlocked('gone-two')).toBe(true);
  expect(isLoginSessionBlocked('kept-sid')).toBe(false);
});

it('does not leave the sid blocked when the revoked-row insert fails', async () => {
  queryRaw
    .mockResolvedValueOnce([{ sid: 'gone-then-rolled-back' }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ sid: 'gone-then-rolled-back' }])
    .mockRejectedValueOnce(new Error('could not keep the revoked row'));
  await expect(destroyUserLoginSessions('u1')).rejects.toBeInstanceOf(LoginSessionStoreUnavailable);
  expect(isLoginSessionBlocked('gone-then-rolled-back')).toBe(false);
  expect(blockLoginSessions).not.toHaveBeenCalled();
});
