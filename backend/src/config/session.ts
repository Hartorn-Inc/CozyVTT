import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import logger from '../utils/logger';
import { rememberMeMaxAge } from './sessionDurations';
import { sessionOptions } from './sessionOptions';
import { sessionSecretProblem, INSECURE_SESSION_SECRETS } from './sessionSecret';
import { databaseConnectionSettings } from './prismaClient';
import { isLoginSessionBlocked } from '../services/revokedLoginSessions';
import { ensureLoginSessionRevocationGuard } from './loginSessionRevocationGuard';

export { rememberMeMaxAge };

const PgSession = connectPgSimple(session);

/**
 * Same name and sentence as LoginSessionStoreUnavailable in
 * services/sessionStore.ts. This file does not import that module: loading it
 * would open a Prisma client every time the session settings are loaded
 * (sessionConfig.test.ts does that in isolation). errorHandler maps either
 * object by `name`.
 */
function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error('Login session store failed');
}

function loginSessionStoreUnavailable(err: unknown): Error {
  const failure = asError(err);
  if (failure.name === 'LoginSessionStoreUnavailable') return failure;
  logger.error('Login session store could not be confirmed', { err: failure });
  const wrapped = new Error('The login session could not be confirmed. Try again in a moment.');
  wrapped.name = 'LoginSessionStoreUnavailable';
  return wrapped;
}

/**
 * connect-pg-simple's published `touch` omits the error argument it actually
 * passes. One hop through `unknown` so a store failure is 503 the same way
 * get/set/destroy are.
 */
type PgStoreTouch = (
  sid: string,
  sess: session.SessionData,
  callback: (err?: unknown) => void,
) => void;

/**
 * Tests pause a store write after the in-memory check and before the inner
 * UPSERT, so a concurrent destroy can land first. Production never sets this.
 */
export const loginSessionWriteBarrier: { wait?: Promise<void> } = {};

/**
 * A store callback error becomes LoginSessionStoreUnavailable so a discrete
 * HTTP action that cannot load the store is 503, not 500. A missing session
 * still calls back with no error, and requireAuth answers 401. A `set` for a
 * sid destroyUserLoginSessions just deleted is a successful no-op, so an
 * in-flight request cannot UPSERT the row back. The in-memory block is the
 * fast path; after it has already passed, the revoked row and trigger skip
 * the write.
 */
export function wrapPgSessionStore<T extends session.Store>(store: T): T {
  const get = store.get.bind(store);
  const set = store.set.bind(store);
  const destroy = store.destroy.bind(store);
  const touch = typeof store.touch === 'function'
    ? store.touch.bind(store)
    : undefined;

  store.get = (sid, callback) => {
    get(sid, (err, sess) => {
      if (err) callback(loginSessionStoreUnavailable(err));
      else callback(err, sess);
    });
  };
  store.set = (sid, sess, callback) => {
    if (isLoginSessionBlocked(sid)) {
      if (callback) callback();
      return;
    }
    const write = () => {
      set(sid, sess, (err) => {
        if (!callback) return;
        if (err) callback(loginSessionStoreUnavailable(err));
        else callback(err);
      });
    };
    const gate = loginSessionWriteBarrier.wait;
    if (gate) {
      void gate.then(write, (err: unknown) => {
        if (callback) callback(loginSessionStoreUnavailable(err));
      });
      return;
    }
    write();
  };
  store.destroy = (sid, callback) => {
    destroy(sid, (err) => {
      if (!callback) return;
      if (err) callback(loginSessionStoreUnavailable(err));
      else callback(err);
    });
  };
  if (touch) {
    const touchWithErr = touch as unknown as PgStoreTouch;
    store.touch = (sid, sess, callback) => {
      if (isLoginSessionBlocked(sid)) {
        if (callback) callback();
        return;
      }
      const write = () => {
        touchWithErr(sid, sess, (err) => {
          if (!callback) return;
          // Published touch types omit the error argument the store passes.
          const done = callback as unknown as (error?: Error) => void;
          if (err) done(loginSessionStoreUnavailable(err));
          else done();
        });
      };
      const gate = loginSessionWriteBarrier.wait;
      if (gate) {
        void gate.then(write, (err: unknown) => {
          if (!callback) return;
          const done = callback as unknown as (error?: Error) => void;
          done(loginSessionStoreUnavailable(err));
        });
        return;
      }
      write();
    };
  }

  return store;
}

// PostgreSQL connection pool for session storage. Exported so a clean
// shutdown can close it.
// Built from databaseConnectionSettings so login sessions live in the
// configured schema with Prisma's raw session SQL (services/sessionStore.ts).
// Instances on public keep their rows; a custom ?schema= gets a new empty
// session table in that schema (one sign-out). When DATABASE_URL is unset,
// the pool is the same connectionString-only construction as before.
const databaseUrl = process.env.DATABASE_URL;
const sessionDatabase = databaseUrl ? databaseConnectionSettings(databaseUrl) : undefined;

export const sessionPool = sessionDatabase
  ? new Pool(sessionDatabase.pool)
  : new Pool({
    connectionString: databaseUrl,
  });

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
// kept in PostgreSQL and signed with SESSION_SECRET.
const pgSessionStore = wrapPgSessionStore(new PgSession({
  pool: sessionPool,
  tableName: 'session',
  createTableIfMissing: true,
  ...(sessionDatabase ? { schemaName: sessionDatabase.schema } : {}),
}));

// After PgSession so createTableIfMissing has been requested. The guard also
// creates session if missing, because that flag only creates the table on a
// later store query and CREATE TRIGGER needs the table on first boot. The
// promise is exported so tests wait until the guard exists; a failure is
// logged so isolateModules loads with a fake address do not surface as
// unhandled rejections.
export const loginSessionRevocationGuard = ensureLoginSessionRevocationGuard(sessionPool);
void loginSessionRevocationGuard.catch((err) => {
  logger.error('Login session revocation guard could not be applied', { err });
});

export const sessionConfig: session.SessionOptions = {
  ...sessionOptions,
  store: pgSessionStore,
  secret: SESSION_SECRET && !INSECURE_SESSION_SECRETS.includes(SESSION_SECRET)
    ? SESSION_SECRET
    : 'dev-only-insecure-secret-do-not-use-in-production',
};
