-- Named sids so a connect-pg-simple UPSERT cannot recreate a login session
-- destroyUserLoginSessions has just deleted. The trigger skips the write
-- when a row is still unexpired; db push creates the table but not the
-- trigger, so the runtime helper reapplies this.

-- CREATE TRIGGER needs this table. Fresh migrate deploy can run this file
-- before 20261015032229_add_login_session_table has been applied in a
-- restore or an empty schema; IF NOT EXISTS matches that earlier migration.
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
