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
const executeRaw = jest.fn();
jest.mock('../../config/database', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    $transaction: (work: (tx: {
      $queryRaw: (...args: unknown[]) => unknown;
      $executeRaw: (...args: unknown[]) => unknown;
    }) => Promise<unknown>) =>
      work({
        $queryRaw: (...args: unknown[]) => queryRaw(...args),
        $executeRaw: (...args: unknown[]) => executeRaw(...args),
      }),
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
jest.mock('../../config/session', () => ({
  sessionPool: {},
}));
jest.mock('../../websocket/utils', () => ({
  endLiveSockets: jest.fn(async () => 0),
}));

import { Prisma } from '@prisma/client';
import { destroyUserLoginSessions, LoginSessionStoreUnavailable } from '../sessionStore';
import { isLoginSessionBlocked } from '../revokedLoginSessions';
import { isSerializationFailure } from '../../utils/serializable';
import logger from '../../utils/logger';

/** A client object distinct from the mocked prisma, as a caller-held transaction. */
function callerTx() {
  return { $queryRaw: queryRaw, $executeRaw: executeRaw } as unknown as Prisma.TransactionClient;
}

function driverAdapterError(cause: Record<string, unknown>) {
  return Object.assign(new Error('driver'), { name: 'DriverAdapterError', cause });
}

function serializationFailure() {
  return driverAdapterError({ kind: 'TransactionWriteConflict', originalCode: '40001' });
}

function p2010SerializationFailure() {
  return new Prisma.PrismaClientKnownRequestError('Raw query failed', {
    code: 'P2010',
    clientVersion: Prisma.prismaVersion.client,
    meta: { driverAdapterError: serializationFailure() },
  });
}

async function rejectedOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (err) {
    return err;
  }
  throw new Error('expected destroyUserLoginSessions to fail');
}

beforeEach(() => {
  queryRaw.mockReset();
  executeRaw.mockReset();
  executeRaw.mockResolvedValue(0);
  jest.mocked(logger.error).mockReset();
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
  const err = new Error('connection terminated');
  queryRaw.mockRejectedValue(err);
  await expect(destroyUserLoginSessions('u1')).rejects.toBeInstanceOf(LoginSessionStoreUnavailable);
  await expect(destroyUserLoginSessions('u1')).rejects.toThrow(
    'The login session could not be confirmed. Try again in a moment.'
  );
  expect(logger.error).toHaveBeenCalledWith('Login session revocation failed', { err });
});

it('wraps a serialization failure as LoginSessionStoreUnavailable when it owns the transaction', async () => {
  const err = serializationFailure();
  queryRaw.mockRejectedValue(err);
  const rejected = await rejectedOf(destroyUserLoginSessions('u1'));
  expect(rejected).toBeInstanceOf(LoginSessionStoreUnavailable);
  expect(rejected).not.toBe(err);
  expect(logger.error).not.toHaveBeenCalled();
});

it('wraps a caller-held 40001 as retryable LoginSessionStoreUnavailable without logging a store outage', async () => {
  const err = serializationFailure();
  queryRaw.mockRejectedValue(err);
  const rejected = await rejectedOf(destroyUserLoginSessions('u1', undefined, callerTx()));
  expect(rejected).toBeInstanceOf(LoginSessionStoreUnavailable);
  expect(isSerializationFailure(rejected)).toBe(true);
  if (!(rejected instanceof LoginSessionStoreUnavailable)) throw new Error('expected LoginSessionStoreUnavailable');
  expect(rejected.cause).toBe(err);
  expect(logger.error).not.toHaveBeenCalled();
});

it('wraps a caller-held P2010 serialization failure as retryable LoginSessionStoreUnavailable', async () => {
  const err = p2010SerializationFailure();
  queryRaw.mockRejectedValue(err);
  const rejected = await rejectedOf(destroyUserLoginSessions('u1', undefined, callerTx()));
  expect(rejected).toBeInstanceOf(LoginSessionStoreUnavailable);
  expect(isSerializationFailure(rejected)).toBe(true);
  if (!(rejected instanceof LoginSessionStoreUnavailable)) throw new Error('expected LoginSessionStoreUnavailable');
  expect(rejected.cause).toBe(err);
  expect(logger.error).not.toHaveBeenCalled();
});

it('wraps a non-serialization failure from a caller-held transaction as LoginSessionStoreUnavailable', async () => {
  const err = new Error('connection terminated');
  queryRaw.mockRejectedValue(err);
  const rejected = await rejectedOf(destroyUserLoginSessions('u1', undefined, callerTx()));
  expect(rejected).toBeInstanceOf(LoginSessionStoreUnavailable);
  expect(isSerializationFailure(rejected)).toBe(false);
  expect(logger.error).toHaveBeenCalledWith('Login session revocation failed', { err });
});

it('blocks the deleted sids and not the session it is asked to keep', async () => {
  queryRaw.mockResolvedValue([{ sid: 'gone-one' }, { sid: 'gone-two' }]);
  await destroyUserLoginSessions('u1', 'kept-sid');
  expect(isLoginSessionBlocked('gone-one')).toBe(true);
  expect(isLoginSessionBlocked('gone-two')).toBe(true);
  expect(isLoginSessionBlocked('kept-sid')).toBe(false);
});

it('keeps all lock and session work on a caller-held client when isolation is not serializable', async () => {
  queryRaw.mockResolvedValue([{ sid: 'a' }]);
  await expect(destroyUserLoginSessions('u1', undefined, callerTx())).resolves.toBe(1);
  expect(blockLoginSessions).not.toHaveBeenCalled();
});

it('does not leave the sid blocked when the revoked-row insert fails', async () => {
  queryRaw
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ sid: 'gone-then-rolled-back' }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ sid: 'gone-then-rolled-back' }])
    .mockRejectedValueOnce(new Error('could not keep the revoked row'));
  await expect(destroyUserLoginSessions('u1')).rejects.toBeInstanceOf(LoginSessionStoreUnavailable);
  expect(isLoginSessionBlocked('gone-then-rolled-back')).toBe(false);
  expect(blockLoginSessions).not.toHaveBeenCalled();
});
