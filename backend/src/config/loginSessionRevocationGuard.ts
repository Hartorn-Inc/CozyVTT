/**
 * Table, index, function and trigger that skip a store UPSERT for a sid
 * destroyUserLoginSessions has named. Prisma db push creates the tables but
 * not the trigger, and this file must not import sessionStore.ts or
 * database.ts: config/session.ts cannot open a Prisma client. The session
 * table is created here too: CREATE TRIGGER needs it, and connect-pg-simple
 * createTableIfMissing only runs on a later store query.
 */

import type { Pool } from 'pg';

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
