import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import logger from '../utils/logger';
import { rememberMeMaxAge } from './sessionDurations';
import { sessionOptions } from './sessionOptions';
import { sessionSecretProblem, INSECURE_SESSION_SECRETS } from './sessionSecret';
import { databaseConnectionSettings } from './prismaClient';

export { rememberMeMaxAge };

const PgSession = connectPgSimple(session);

// PostgreSQL connection pool for session storage. Exported so a clean
// shutdown can close it. Built from the same DATABASE_URL reading as Prisma
// (databaseConnectionSettings), including `?schema=` as search_path, so the
// connect-pg-simple table and the raw session queries in
// services/sessionStore.ts are the same table. Importing this file does not
// connect; a missing DATABASE_URL still constructs a pool.
const databaseUrl = process.env.DATABASE_URL;
const loginSessionDatabase = databaseUrl ? databaseConnectionSettings(databaseUrl) : undefined;

/** PostgreSQL schema the login-session table lives in (`public` unless `?schema=` says otherwise). */
export const loginSessionSchemaName = loginSessionDatabase?.schema ?? 'public';

export const sessionPool = new Pool(loginSessionDatabase?.pool ?? { connectionString: databaseUrl });

// node-postgres emits 'error' on the pool when an idle connection drops, as
// every one does when PostgreSQL stops or restarts. An 'error' event with no
// listener is thrown and would end the process. The pool opens a new
// connection for the next query, so the drop is only logged.
sessionPool.on('error', (err) => {
  logger.error('Session store lost a database connection', { err });
});

// SESSION_SECRET signs the session cookie. A production server stops here on
// a value anyone could guess: unset, an example value the example files or
// the guides show, or one too short to have been generated. The list and the
// rule are in config/sessionSecret.ts, where a test holds the guides to them.
const SESSION_SECRET = process.env.SESSION_SECRET;
const secretProblem = sessionSecretProblem(SESSION_SECRET);

if (secretProblem) {
  if (process.env.NODE_ENV === 'production') {
    logger.error(
      `[FATAL] SESSION_SECRET ${secretProblem}. ` +
        'Generate a strong secret with: openssl rand -hex 32'
    );
    process.exit(1);
  } else {
    // Docker development passes DEV_SESSION_SECRET from the root .env into
    // SESSION_SECRET. `make up` requires a separate development secret with
    // at least 32 characters; backend/.env is for non-Docker/manual
    // development only.
    logger.warn(
      `[WARN] SESSION_SECRET ${secretProblem}. ` +
        'Set a real secret in backend/.env before deploying; generate one with: openssl rand -hex 32'
    );
  }
}

// Session configuration: the behaviour and cookie in config/sessionOptions.ts,
// kept in PostgreSQL and signed with SESSION_SECRET. schemaName is what
// connect-pg-simple 10 uses for the table; pg itself ignores `?schema=` in
// the address, so the name has to be passed here.
export const sessionConfig: session.SessionOptions = {
  ...sessionOptions,
  store: new PgSession({
    pool: sessionPool,
    tableName: 'session',
    schemaName: loginSessionSchemaName,
    createTableIfMissing: true,
  }),
  secret: SESSION_SECRET && !INSECURE_SESSION_SECRETS.includes(SESSION_SECRET)
    ? SESSION_SECRET
    : 'dev-only-insecure-secret-do-not-use-in-production',
};
