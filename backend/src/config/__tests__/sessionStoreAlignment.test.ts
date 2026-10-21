/**
 * The Express login-session store and Prisma revocation see the same table.
 *
 * connect-pg-simple used to ignore `?schema=` and write public.session, while
 * Prisma raw SQL followed search_path, so destroyUserLoginSessions could miss
 * the rows Express reads. Both now use databaseConnectionSettings; this file
 * writes through the pg store in a non-public schema and proves Prisma sees
 * that row and can delete it.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import { createIsolatedSchema } from '../../__tests__/helpers/isolatedSchema';
import { createPrismaClient, databaseConnectionSettings } from '../prismaClient';
import { destroyUserLoginSessions } from '../../services/sessionStore';

jest.setTimeout(60000);

const PgSession = connectPgSimple(session);

it('lets destroyUserLoginSessions remove a row the Express pg store wrote in the configured schema', async () => {
  const isolated = createIsolatedSchema('login_session_align_test');
  const settings = databaseConnectionSettings(isolated.url);
  expect(settings.schema).toBe('login_session_align_test');

  const pool = new Pool(settings.pool);
  const prisma = createPrismaClient(isolated.url);
  const store = new PgSession({
    pool,
    tableName: 'session',
    schemaName: settings.schema,
    createTableIfMissing: true,
  });

  const sid = `align-${randomUUID()}`;
  const userId = randomUUID();
  const sess: session.SessionData = {
    cookie: { originalMaxAge: 60 * 60 * 1000 },
    userId,
  };

  try {
    await new Promise<void>((resolve, reject) => {
      store.set(sid, sess, (err) => (err ? reject(err) : resolve()));
    });

    const seen = await prisma.$queryRaw<{ sid: string }[]>`
      SELECT sid FROM session WHERE sid = ${sid}
    `;
    expect(seen).toEqual([{ sid }]);

    expect(await destroyUserLoginSessions(userId, undefined, prisma)).toBe(1);

    const after = await prisma.$queryRaw<{ sid: string }[]>`
      SELECT sid FROM session WHERE sid = ${sid}
    `;
    expect(after).toEqual([]);
  } finally {
    store.close();
    await prisma.$disconnect();
    await pool.end();
    isolated.drop();
  }
});
