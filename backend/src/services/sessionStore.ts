import session from 'express-session';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/database';

/**
 * Login-session helpers.
 *
 * Express login sessions live in the `session` table owned by
 * connect-pg-simple (see config/session.ts) — not in Prisma's `Session` model,
 * which tracks in-game campaign sessions. The same raw-SQL access pattern is
 * used by the admin activity endpoint's online-users list.
 */

/** Shown to the caller when the login-session store cannot be confirmed. */
export const LOGIN_SESSION_STORE_UNAVAILABLE_MESSAGE =
  'The sign-in store cannot be reached. Try again in a minute.';

export const LOGIN_SESSION_STORE_UNAVAILABLE_BODY = {
  error: 'Service Unavailable',
  message: LOGIN_SESSION_STORE_UNAVAILABLE_MESSAGE,
};

/**
 * The login-session store could not be confirmed (a get/set/destroy or a
 * revocation DELETE failed). Routes and the last-resort error handler answer
 * 503; they must not report success, and they must not use this for a missing
 * or revoked session, which is 401.
 */
export class LoginSessionStoreUnavailable extends Error {
  override readonly name = 'LoginSessionStoreUnavailable';

  constructor(cause: unknown) {
    super(LOGIN_SESSION_STORE_UNAVAILABLE_MESSAGE, { cause });
  }
}

export function isLoginSessionStoreUnavailable(error: unknown): error is LoginSessionStoreUnavailable {
  if (error instanceof LoginSessionStoreUnavailable) return true;
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'LoginSessionStoreUnavailable') {
    return true;
  }
  if (typeof error === 'object' && error !== null && 'cause' in error && error.cause !== error) {
    return isLoginSessionStoreUnavailable(error.cause);
  }
  return false;
}

function taggedStoreError(err: unknown): LoginSessionStoreUnavailable {
  return err instanceof LoginSessionStoreUnavailable ? err : new LoginSessionStoreUnavailable(err);
}

/**
 * Tag connect-pg-simple (or any express-session Store) get/set/destroy/touch
 * failures so the error handler answers 503 rather than 500. A missing row
 * is still callback(null), which stays 401 at requireAuth. Rolling cookies
 * (`sessionOptions.rolling`) call store.touch on idle authenticated HTTP.
 */
export type GuardedLoginSessionStore = session.Store & {
  touch(sid: string, sess: session.SessionData, callback?: (err?: Error) => void): void;
};

export function wrapLoginSessionStore(inner: session.Store): GuardedLoginSessionStore {
  return new GuardedLoginSessionStoreImpl(inner);
}

class GuardedLoginSessionStoreImpl extends session.Store {
  constructor(private readonly inner: session.Store) {
    super();
  }

  get(sid: string, callback: (err: Error | null, sess?: session.SessionData | null) => void): void {
    try {
      this.inner.get(sid, (err, sess) => {
        callback(err ? taggedStoreError(err) : null, sess);
      });
    } catch (err) {
      callback(taggedStoreError(err));
    }
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: Error) => void): void {
    try {
      this.inner.set(sid, sess, (err) => {
        if (!callback) return;
        callback(err ? taggedStoreError(err) : err);
      });
    } catch (err) {
      if (callback) callback(taggedStoreError(err));
      else throw taggedStoreError(err);
    }
  }

  destroy(sid: string, callback?: (err?: Error) => void): void {
    try {
      this.inner.destroy(sid, (err) => {
        if (!callback) return;
        callback(err ? taggedStoreError(err) : err);
      });
    } catch (err) {
      if (callback) callback(taggedStoreError(err));
      else throw taggedStoreError(err);
    }
  }

  touch(sid: string, sess: session.SessionData, callback?: (err?: Error) => void): void {
    const innerTouch = this.inner.touch;
    if (typeof innerTouch !== 'function') {
      // Stores that omit touch are not fail-open rolling: express-session
      // only calls store.touch when the method exists. The wrapper always
      // has one, so a missing inner.touch is a no-op with no error, matching
      // MemoryStore's own success callback.
      if (callback) callback();
      return;
    }
    const finish = (err?: Error) => {
      if (!callback) {
        if (err) throw taggedStoreError(err);
        return;
      }
      callback(err ? taggedStoreError(err) : err);
    };
    try {
      innerTouch.call(this.inner, sid, sess, finish);
    } catch (err) {
      finish(err instanceof Error ? err : taggedStoreError(err));
    }
  }
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
  // Not caught as success: a revocation that did not take must fail the
  // request that asked for it. A store failure is tagged so the route answers
  // 503 rather than 500, and a surrounding transaction rolls back.
  try {
    return exceptSessionId
      ? await db.$executeRaw`
          DELETE FROM session
          WHERE (sess->>'userId' = ${userId} OR sess->>'mfaPendingUserId' = ${userId})
            AND sid <> ${exceptSessionId}
        `
      : await db.$executeRaw`
          DELETE FROM session
          WHERE sess->>'userId' = ${userId} OR sess->>'mfaPendingUserId' = ${userId}
        `;
  } catch (error) {
    throw taggedStoreError(error);
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
