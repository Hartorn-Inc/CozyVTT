import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { rememberMeMaxAge } from '../config/sessionDurations';
import { LOGIN_SESSION_SID_LOCK, LOGIN_SESSION_USER_LOCK } from '../config/loginSessionRevocationGuard';
import logger from '../utils/logger';
import { isSerializationFailure } from '../utils/serializable';
import { blockLoginSessions, unblockLoginSessions } from './revokedLoginSessions';

/**
 * Login-session helpers.
 *
 * Express login sessions live in the `session` table owned by
 * connect-pg-simple (see config/session.ts) — not in Prisma's `Session` model,
 * which tracks in-game campaign sessions. The same raw-SQL access pattern is
 * used by the admin activity endpoint's online-users list.
 */

/**
 * The login-session store could not be confirmed, so the mutation must not
 * report success. errorHandler answers 503; the sentence is for the person
 * and does not describe the database.
 */
export class LoginSessionStoreUnavailable extends Error {
  constructor(cause?: unknown) {
    super(
      'The login session could not be confirmed. Try again in a moment.',
      cause !== undefined ? { cause } : undefined,
    );
    this.name = 'LoginSessionStoreUnavailable';
  }
}

/** Whether a failure is (or wraps) an unconfirmable login-session store. */
export function isLoginSessionStoreUnavailable(error: unknown, depth = 0): boolean {
  if (error instanceof LoginSessionStoreUnavailable) return true;
  if (error instanceof Error && error.name === 'LoginSessionStoreUnavailable') return true;
  if (depth < 5 && typeof error === 'object' && error !== null && 'cause' in error) {
    return isLoginSessionStoreUnavailable(error.cause, depth + 1);
  }
  return false;
}

/**
 * Routes that catch every error and answer 500 rethrow this one so
 * errorHandler can answer 503 instead.
 */
export function rethrowIfLoginSessionStoreUnavailable(error: unknown): void {
  if (!isLoginSessionStoreUnavailable(error)) return;
  throw error instanceof LoginSessionStoreUnavailable ? error : new LoginSessionStoreUnavailable();
}

async function selectUserLoginSessionSids(
  userId: string,
  exceptSessionId: string | undefined,
  db: Prisma.TransactionClient,
  forUpdate: boolean,
): Promise<string[]> {
  const lock = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.sql``;
  const rows = exceptSessionId
    ? await db.$queryRaw<{ sid: string }[]>`
        SELECT sid FROM session
        WHERE (sess->>'userId' = ${userId} OR sess->>'mfaPendingUserId' = ${userId})
          AND sid <> ${exceptSessionId}
        ${lock}
      `
    : await db.$queryRaw<{ sid: string }[]>`
        SELECT sid FROM session
        WHERE sess->>'userId' = ${userId} OR sess->>'mfaPendingUserId' = ${userId}
        ${lock}
      `;
  return rows.map((row) => row.sid);
}

async function lockLoginSessionUser(db: Prisma.TransactionClient, userId: string): Promise<void> {
  await db.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(${LOGIN_SESSION_USER_LOCK}, hashtext(${userId}::text))) AS lock
  `;
}

async function lockLoginSessionSid(db: Prisma.TransactionClient, sid: string): Promise<void> {
  await db.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(${LOGIN_SESSION_SID_LOCK}, hashtext(${sid}::text))) AS lock
  `;
}

async function deleteAndRevokeLoginSessions(
  userId: string,
  exceptSessionId: string | undefined,
  db: Prisma.TransactionClient,
): Promise<string[]> {
  // User lock then epoch increment first, even when this user has no session
  // to revoke: a concurrent first login after reset must not land. Then
  // expired markers, then per-sid locks (same order as the store write: user
  // then sid), then FOR UPDATE, so a writer waiting on the lock cannot INSERT
  // a new sid while this transaction holds the row and this transaction waits
  // on the lock.
  await lockLoginSessionUser(db, userId);
  await db.$executeRaw`
    UPDATE "User" SET "loginSessionEpoch" = "loginSessionEpoch" + 1 WHERE id = ${userId}
  `;
  await db.$executeRaw`DELETE FROM revoked_login_session WHERE expires_at <= NOW()`;
  const preview = await selectUserLoginSessionSids(userId, exceptSessionId, db, false);
  if (preview.length === 0) return preview;
  for (const sid of preview) await lockLoginSessionSid(db, sid);
  const sids = await selectUserLoginSessionSids(userId, exceptSessionId, db, true);
  if (sids.length === 0) return sids;
  for (const sid of sids) {
    if (!preview.includes(sid)) await lockLoginSessionSid(db, sid);
  }
  const expiresAt = new Date(Date.now() + rememberMeMaxAge);
  await db.$queryRaw<{ sid: string }[]>`
    INSERT INTO revoked_login_session (sid, expires_at)
    VALUES ${Prisma.join(sids.map((sid) => Prisma.sql`(${sid}, ${expiresAt})`))}
    ON CONFLICT (sid) DO UPDATE SET expires_at = EXCLUDED.expires_at
    RETURNING sid
  `;
  await db.$queryRaw`
    DELETE FROM session WHERE sid IN (${Prisma.join(sids.map((sid) => Prisma.sql`${sid}`))})
  `;
  return sids;
}

function isPgDeadlock(err: unknown, depth = 0): boolean {
  if (depth > 5 || typeof err !== 'object' || err === null) return false;
  if ('code' in err && (err.code === '40P01' || err.code === 'P2034')) return true;
  if ('message' in err && typeof err.message === 'string' && /deadlock detected|40P01/.test(err.message)) {
    return true;
  }
  if ('cause' in err) return isPgDeadlock(err.cause, depth + 1);
  return false;
}

async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await work();
    } catch (err) {
      lastErr = err;
      if (!isPgDeadlock(err)) throw err;
    }
  }
  throw lastErr;
}

/**
 * End every login session belonging to a user, the sign-ins waiting at the
 * two-factor step included.
 *
 * Used when an admin resets someone's password, when their role or permissions
 * change, and when their account is deleted (inside the deletion's own
 * transaction, through `db`): the guards read the role from the session and
 * nothing re-reads it, so without this the person keeps whatever they had
 * until they happen to sign out.
 *
 * A session that has passed the password step but not the code holds only
 * `mfaPendingUserId`. It goes too: the password it proved is the one being
 * replaced, so it must not be turned into a sign-in afterwards.
 *
 * `exceptSessionId` keeps one session alive, which is what a self-service
 * password change wants: the other devices are signed out and the person who
 * just changed it stays where they are.
 *
 * @returns number of sessions removed
 */
export async function destroyUserLoginSessions(
  userId: string,
  exceptSessionId?: string,
  db: Prisma.TransactionClient = prisma
): Promise<number> {
  // A revocation that did not take must fail the request that asked for it,
  // so the person is told, instead of reporting success while the old
  // sessions keep their role until they expire. Store or SQL failures become
  // LoginSessionStoreUnavailable (503), not a swallowed zero.
  // A user-scoped advisory lock and epoch increment, then per-sid advisory
  // locks, SELECT FOR UPDATE, the revoked_login_session INSERT and DELETE
  // share one transaction so a later store UPSERT cannot recreate a deleted
  // sid or insert a new one minted with the previous epoch. exceptSessionId
  // stays in the WHERE, so it is not returned and not revoked. In-memory
  // blocking waits until this helper's own transaction commits: a
  // caller-supplied client is already in a transaction, and a rollback must
  // not leave a block that would refuse a later write of a sid that is still
  // in the table. If this helper fails after blocking, those sids are
  // unblocked.
  let sids: string[] = [];
  try {
    if (db === prisma) {
      sids = await withDeadlockRetry(() =>
        prisma.$transaction((tx) => deleteAndRevokeLoginSessions(userId, exceptSessionId, tx)),
      );
      blockLoginSessions(sids);
    } else {
      sids = await deleteAndRevokeLoginSessions(userId, exceptSessionId, db);
    }
    return sids.length;
  } catch (err) {
    unblockLoginSessions(sids);
    if (err instanceof LoginSessionStoreUnavailable) throw err;
    // Always wrap so credential routes stay 503. SERIALIZABLE last-admin
    // retries still run: isSerializationFailure walks this error's cause.
    // A 40001/40P01 is that retry, not a store outage.
    if (!isSerializationFailure(err)) {
      logger.error('Login session revocation failed', { err });
    }
    throw new LoginSessionStoreUnavailable(err);
  }
}

/**
 * How many live sessions one account keeps. Every sign-in without a cookie
 * writes a row, and nothing capped them, so a script signing in 300 times a
 * minute grew the table by hundreds of thousands of rows a day, each living 30
 * days with remember me. Twenty is far more devices and browsers than a
 * person signs in from; a sign-in past it ends the account's oldest.
 */
export const MAX_SESSIONS_PER_USER = 20;

/**
 * Called at sign-in with the new session's id: removes the account's oldest
 * sessions (those expiring soonest, pending two-factor sign-ins included)
 * beyond the cap, keeping the new one.
 *
 * @returns number of sessions removed
 */
export async function capLoginSessions(userId: string, keepSessionId: string): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM session
    WHERE sid IN (
      SELECT sid FROM session
      WHERE (sess->>'userId' = ${userId} OR sess->>'mfaPendingUserId' = ${userId})
        AND sid <> ${keepSessionId}
      ORDER BY expire DESC
      OFFSET ${MAX_SESSIONS_PER_USER - 1}
    )
  `;
}
