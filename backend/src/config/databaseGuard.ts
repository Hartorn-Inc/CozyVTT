/**
 * Refuse to run a production instance on the placeholder database password.
 *
 * `.env.example` ships `DATABASE_PASSWORD=CHANGE_ME_TO_SECURE_PASSWORD`, and
 * both services use it as-is. Nothing refused to boot on it, while the same
 * mistake with SESSION_SECRET has always been fatal in production. Postgres is
 * not published to the host in the shipped compose file, so this is defence in
 * depth, but it is exactly the "self-hoster forgets a secret and it still runs"
 * case the threat model names.
 *
 * Production also refuses to boot when the connected role is a PostgreSQL
 * superuser. ADR 0012: migrations and app access use the non-superuser schema
 * owner; staying superuser for a dual-mode release was rejected. Development
 * and test still warn, because Jest CI connects as the cluster's POSTGRES_USER.
 */

import { prisma } from './database';
import logger from '../utils/logger';

/** The passwords the templates ship with. */
const PLACEHOLDER_PASSWORDS = ['CHANGE_ME_TO_SECURE_PASSWORD', 'CHANGE_ME'];

/** Why a database URL should not be used, or null when it is fine. */
export function databaseCredentialProblem(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return 'DATABASE_URL is not set';
  let password: string;
  try {
    password = decodeURIComponent(new URL(databaseUrl).password);
  } catch {
    return 'DATABASE_URL is not a valid connection string';
  }
  if (PLACEHOLDER_PASSWORDS.includes(password)) {
    return 'DATABASE_URL uses the placeholder password from .env.example';
  }
  return null;
}

/**
 * The database user and name a URL connects as, for the commands the refusal
 * prints. On Docker that user is the schema owner (DATABASE_APP_USER); the
 * bootstrap superuser stays DATABASE_USER (default cozyvtt). DATABASE_NAME
 * may have been changed in .env. The shipped defaults when the URL names
 * neither, or cannot be read.
 */
function connectionNames(databaseUrl: string | undefined): { user: string; database: string } {
  try {
    const url = new URL(databaseUrl ?? '');
    return {
      user: decodeURIComponent(url.username) || 'cozyvtt',
      database: decodeURIComponent(url.pathname.slice(1)) || 'cozyvtt',
    };
  } catch {
    return { user: 'cozyvtt', database: 'cozyvtt' };
  }
}

/**
 * Called once at startup. Production exits; anything else warns, so a
 * developer's throwaway database keeps working.
 */
export function enforceDatabaseCredential(
  env: Record<string, string | undefined> = process.env,
  exit: (code: number) => void = (code) => process.exit(code)
): void {
  const problem = databaseCredentialProblem(env.DATABASE_URL);
  if (!problem) return;
  if (env.NODE_ENV === 'production') {
    // An instance that has already run keeps the password its database was
    // created with, whatever .env says, so the order of the steps matters.
    const { user, database } = connectionNames(env.DATABASE_URL);
    logger.error(
      `[FATAL] ${problem}. On Docker, change both roles inside the database first ` +
        `(bootstrap superuser DATABASE_USER, default cozyvtt, connecting with -U, and the schema owner): ` +
        `docker compose exec database psql -U cozyvtt -d ${database} -c "ALTER USER cozyvtt WITH PASSWORD '<new>';" ` +
        `then docker compose exec database psql -U cozyvtt -d ${database} -c "ALTER USER ${user} WITH PASSWORD '<new>';" ` +
        '(openssl rand -hex 24 makes a good one). If you changed DATABASE_USER, put that name in place of cozyvtt ' +
        'after -U and after the first ALTER USER. Then set DATABASE_PASSWORD in .env to the same value ' +
        '(and DATABASE_APP_PASSWORD too if you set that separately), ' +
        'update DATABASE_URL too if you wrote it by hand, and run docker compose up -d. ' +
        'See docs/DEPLOYMENT.md, "Changing the database password".'
    );
    exit(1);
    return;
  }
  logger.warn(`[WARN] ${problem}. Fine for development; a production instance refuses to start like this.`);
}

/** Why a connected superuser (or a role we could not check) must not boot production. */
const SUPERUSER_ROLE_PROBLEM =
  'The connected PostgreSQL role is a superuser. The app must use the non-superuser schema owner. ' +
  'On Docker, start.sh creates DATABASE_APP_USER (default cozyvtt_app) from the bootstrap superuser ' +
  '(DATABASE_USER) before migrate; if this process still connected as a superuser, DATABASE_URL is wrong. ' +
  'See docs/DEPLOYMENT.md.';

const ROLE_CHECK_FAILED =
  'Could not verify that the connected PostgreSQL role is not a superuser. ' +
  'Production refuses to start unless that check succeeds. See docs/DEPLOYMENT.md.';

const DEV_STILL_RUNS = 'Fine for development; a production instance refuses to start like this.';

/** How tests (and the default Prisma query) decide whether the connected role is a superuser. */
export type ConnectedRoleSuperuserQuery = () => Promise<boolean>;

/**
 * Whether the role this process connected as is a PostgreSQL superuser.
 * `pg_roles.rolsuper` for `current_user`; anything else is a failed check,
 * not a pass.
 */
async function queryConnectedRoleIsSuperuser(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ rolsuper: boolean }[]>`
    SELECT rolsuper FROM pg_roles WHERE rolname = current_user
  `;
  if (rows[0]?.rolsuper === true) return true;
  if (rows[0]?.rolsuper === false) return false;
  throw new Error('rolsuper was not returned for the connected role');
}

/**
 * Called once at startup, before the process accepts HTTP. Production exits
 * when the connected role is a superuser, or when that cannot be checked.
 * Anything else warns, so Jest CI (which uses the cluster superuser) keeps
 * working.
 */
export async function enforceDatabaseRole(
  env: Record<string, string | undefined> = process.env,
  exit: (code: number) => void = (code) => process.exit(code),
  queryRolsuper: ConnectedRoleSuperuserQuery = queryConnectedRoleIsSuperuser
): Promise<void> {
  let isSuperuser: boolean;
  try {
    const value: unknown = await queryRolsuper();
    if (value !== true && value !== false) {
      throw new Error('rolsuper was not a boolean');
    }
    isSuperuser = value;
  } catch (err: unknown) {
    if (env.NODE_ENV === 'production') {
      logger.error(`[FATAL] ${ROLE_CHECK_FAILED}`, { err });
      exit(1);
      return;
    }
    logger.warn(`[WARN] ${ROLE_CHECK_FAILED} ${DEV_STILL_RUNS}`, { err });
    return;
  }

  if (!isSuperuser) return;

  if (env.NODE_ENV === 'production') {
    logger.error(`[FATAL] ${SUPERUSER_ROLE_PROBLEM}`);
    exit(1);
    return;
  }
  logger.warn(`[WARN] ${SUPERUSER_ROLE_PROBLEM} ${DEV_STILL_RUNS}`);
}
