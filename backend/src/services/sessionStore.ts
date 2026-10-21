import type { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import logger from '../utils/logger';
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
  constructor() {
    super('The login session could not be confirmed. Try again in a moment.');
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
  // One DELETE … RETURNING so a row inserted between a SELECT and a DELETE
  // cannot be removed without being blocked. exceptSessionId stays in the
  // WHERE, so it is not returned and not blocked. If this helper fails after
  // blocking, those sids are unblocked so a rolled-back DELETE can be written
  // again.
  let sids: string[] = [];
  try {
    const rows = exceptSessionId
      ? await db.$queryRaw<{ sid: string }[]>`
          DELETE FROM session
          WHERE (sess->>'userId' = ${userId} OR sess->>'mfaPendingUserId' = ${userId})
            AND sid <> ${exceptSessionId}
          RETURNING sid
        `
      : await db.$queryRaw<{ sid: string }[]>`
          DELETE FROM session
          WHERE sess->>'userId' = ${userId} OR sess->>'mfaPendingUserId' = ${userId}
          RETURNING sid
        `;
    sids = rows.map((row) => row.sid);
    blockLoginSessions(sids);
    return sids.length;
  } catch (err) {
    unblockLoginSessions(sids);
    if (err instanceof LoginSessionStoreUnavailable) throw err;
    logger.error('Login session revocation failed', { err });
    throw new LoginSessionStoreUnavailable();
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
