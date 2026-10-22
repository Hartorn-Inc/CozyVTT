/**
 * Table, index, function and trigger that skip a store UPSERT for a sid
 * destroyUserLoginSessions has named. Prisma db push creates the tables but
 * not the trigger, and this file must not import sessionStore.ts or
 * database.ts: config/session.ts cannot open a Prisma client. The session
 * table is created here too: CREATE TRIGGER needs it, and connect-pg-simple
 * createTableIfMissing only runs on a later store query.
 */

import type { Pool, PoolClient } from 'pg';
import type session from 'express-session';
import { sessionMaxAge } from './sessionDurations';

/** First key of pg_advisory_xact_lock so a store write and destroy serialize on one sid. */
export const LOGIN_SESSION_SID_LOCK = 8723641;

/** First key of pg_advisory_xact_lock so a store write and destroy serialize on one user. Always taken before LOGIN_SESSION_SID_LOCK. */
export const LOGIN_SESSION_USER_LOCK = 8723642;

/** Idempotent SQL the session pool applies so every schema the store uses is guarded. */
export const LOGIN_SESSION_REVOCATION_GUARD_SQL = `
CREATE TABLE IF NOT EXISTS "session" (
    "sid" VARCHAR NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session"("expire");
CREATE TABLE IF NOT EXISTS "revoked_login_session" (
    "sid" VARCHAR NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "revoked_login_session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_revoked_login_session_expires" ON "revoked_login_session"("expires_at");
CREATE OR REPLACE FUNCTION reject_revoked_login_session()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "revoked_login_session"
     WHERE "sid" = NEW.sid AND "expires_at" > NOW()
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS session_reject_revoked ON "session";
CREATE TRIGGER session_reject_revoked
  BEFORE INSERT OR UPDATE ON "session"
  FOR EACH ROW
  EXECUTE FUNCTION reject_revoked_login_session();
`;

export async function ensureLoginSessionRevocationGuard(pool: Pool): Promise<void> {
  // One connection holds the lock for the DDL: pool.query would take a
  // second connection for the unlock, and CREATE OR REPLACE FUNCTION races
  // when tests load session.ts more than once against the same database.
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('login_session_revocation_guard'))");
    try {
      await client.query(LOGIN_SESSION_REVOCATION_GUARD_SQL);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('login_session_revocation_guard'))");
    }
  } finally {
    client.release();
  }
}

function expireUnixSeconds(sess: session.SessionData): number {
  const expires = sess.cookie.expires;
  if (expires) return Math.ceil(new Date(expires).getTime() / 1000);
  return Math.ceil(Date.now() / 1000 + sessionMaxAge / 1000);
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

async function inLoginSessionWriteTx(pool: Pool, work: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await client.query('BEGIN');
        await work(client);
        await client.query('COMMIT');
        return;
      } catch (err) {
        lastErr = err;
        try {
          await client.query('ROLLBACK');
        } catch {
          // The connection is already failed; retry or throw below.
        }
        if (!isPgDeadlock(err)) throw err;
      }
    }
    throw lastErr;
  } finally {
    client.release();
  }
}

function boundLoginSessionUserId(sess: session.SessionData): string | null {
  if (typeof sess.userId === 'string') return sess.userId;
  if (typeof sess.mfaPendingUserId === 'string') return sess.mfaPendingUserId;
  return null;
}

function boundLoginSessionEpoch(sess: session.SessionData): number | null {
  return typeof sess.loginSessionEpoch === 'number' ? sess.loginSessionEpoch : null;
}

/**
 * UPSERT a login session unless destroyUserLoginSessions has named the sid
 * in revoked_login_session, or (for a new sid bound to an account) the
 * stamped loginSessionEpoch no longer matches User.loginSessionEpoch.
 * Takes the user lock then the sid lock, the same order destroy uses, so a
 * connect-pg-simple INSERT cannot pass the trigger, wait on the row, and
 * recreate it after DELETE commits, and a concurrent first login after
 * reset cannot land. A skipped INSERT is a successful no-op.
 */
export async function writeLoginSessionUnlessRevoked(
  pool: Pool,
  sid: string,
  sess: session.SessionData,
): Promise<void> {
  const userId = boundLoginSessionUserId(sess);
  const epoch = boundLoginSessionEpoch(sess);
  await inLoginSessionWriteTx(pool, async (client) => {
    if (userId !== null) {
      await client.query(
        `SELECT pg_advisory_xact_lock(${LOGIN_SESSION_USER_LOCK}, hashtext($1::text))`,
        [userId],
      );
    }
    await client.query(
      `SELECT pg_advisory_xact_lock(${LOGIN_SESSION_SID_LOCK}, hashtext($1::text))`,
      [sid],
    );
    // Epoch match is required only for a new sid: ON CONFLICT update of a
    // kept exceptSessionId must still save after destroy increments epoch.
    await client.query(
      `INSERT INTO session (sess, expire, sid)
       SELECT $1::json, to_timestamp($2), $3::varchar
       WHERE NOT EXISTS (
         SELECT 1 FROM revoked_login_session WHERE sid = $3::varchar AND expires_at > NOW()
       )
       AND (
         EXISTS (SELECT 1 FROM session WHERE sid = $3::varchar)
         OR $4::text IS NULL
         OR EXISTS (
           SELECT 1 FROM "User" WHERE id = $4::text AND "loginSessionEpoch" = $5::int
         )
       )
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire
       WHERE NOT EXISTS (
         SELECT 1 FROM revoked_login_session WHERE sid = EXCLUDED.sid AND expires_at > NOW()
       )`,
      [JSON.stringify(sess), expireUnixSeconds(sess), sid, userId, epoch],
    );
  });
}

/**
 * Extend a login session's expiry unless the sid is still revoked.
 * Sid-lock only: taking the user lock here would invert lock order vs
 * write/destroy.
 */
export async function touchLoginSessionUnlessRevoked(
  pool: Pool,
  sid: string,
  sess: session.SessionData,
): Promise<void> {
  await inLoginSessionWriteTx(pool, async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(${LOGIN_SESSION_SID_LOCK}, hashtext($1::text))`,
      [sid],
    );
    await client.query(
      `UPDATE session SET expire = to_timestamp($1)
       WHERE sid = $2::varchar
         AND NOT EXISTS (
           SELECT 1 FROM revoked_login_session WHERE sid = $2::varchar AND expires_at > NOW()
         )`,
      [expireUnixSeconds(sess), sid],
    );
  });
}
