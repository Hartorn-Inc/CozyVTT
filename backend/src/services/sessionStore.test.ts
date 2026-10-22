/**
 * Ending a user's login sessions, and the one case that keeps one.
 *
 * These rows belong to connect-pg-simple, not to the Prisma client. The
 * table is in schema.prisma, so a test database laid out by `prisma db push`
 * has it, and the real SQL runs here. Other
 * suites read the table at the same time, so this one touches only its own
 * rows.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { Pool } from 'pg';
import { prisma } from '../config/database';
import { ensureLoginSessionRevocationGuard } from '../config/loginSessionRevocationGuard';
import { databaseConnectionSettings } from '../config/prismaClient';
import { destroyUserLoginSessions } from './sessionStore';
import { isLoginSessionBlocked } from './revokedLoginSessions';

const ALICE = 'user-alice';
const BOB = 'user-bob';

async function addSession(sid: string, userId: string) {
  await prisma.$executeRaw`
    INSERT INTO session (sid, sess, expire)
    VALUES (${sid}, ${JSON.stringify({ userId })}::json, NOW() + INTERVAL '1 hour')
  `;
}

const sidsFor = async (userId: string): Promise<string[]> => {
  const rows = await prisma.$queryRaw<{ sid: string }[]>`
    SELECT sid FROM session WHERE sess->>'userId' = ${userId} ORDER BY sid
  `;
  return rows.map((r) => r.sid);
};

const OWN_SIDS = ['alice-laptop', 'alice-phone', 'alice-tablet', 'bob-laptop'] as const;

const removeOwnRows = async () => {
  await prisma.$executeRaw`DELETE FROM session WHERE sess->>'userId' IN (${ALICE}, ${BOB})`;
  await prisma.$executeRaw`DELETE FROM revoked_login_session WHERE sid IN (${OWN_SIDS[0]}, ${OWN_SIDS[1]}, ${OWN_SIDS[2]}, ${OWN_SIDS[3]})`;
};

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('This test needs DATABASE_URL');
  const pool = new Pool(databaseConnectionSettings(url).pool);
  try {
    await ensureLoginSessionRevocationGuard(pool);
  } finally {
    await pool.end();
  }
});

beforeEach(async () => {
  await removeOwnRows();
  await addSession('alice-laptop', ALICE);
  await addSession('alice-phone', ALICE);
  await addSession('alice-tablet', ALICE);
  await addSession('bob-laptop', BOB);
});

afterAll(async () => {
  await removeOwnRows();
  await prisma.$disconnect();
});

describe('destroyUserLoginSessions', () => {
  it('ends every session the user has', async () => {
    const removed = await destroyUserLoginSessions(ALICE);
    expect(removed).toBe(3);
    expect(await sidsFor(ALICE)).toEqual([]);
  });

  it('leaves other people signed in', async () => {
    await destroyUserLoginSessions(ALICE);
    expect(await sidsFor(BOB)).toEqual(['bob-laptop']);
  });

  it('keeps the one session it is told to keep', async () => {
    // What a password change needs: sign out the other devices, and leave the
    // person who just changed it where they are.
    const removed = await destroyUserLoginSessions(ALICE, 'alice-phone');
    expect(removed).toBe(2);
    expect(await sidsFor(ALICE)).toEqual(['alice-phone']);
  });

  it('still ends the rest when the kept session is not theirs', async () => {
    const removed = await destroyUserLoginSessions(ALICE, 'bob-laptop');
    expect(removed).toBe(3);
    expect(await sidsFor(ALICE)).toEqual([]);
    expect(await sidsFor(BOB)).toEqual(['bob-laptop']);
  });

  it('does not leave a deleted sid in session, and names it in revoked_login_session', async () => {
    await destroyUserLoginSessions(ALICE);
    await addSession('alice-laptop', ALICE);
    expect(await sidsFor(ALICE)).toEqual([]);
    const revoked = await prisma.$queryRaw<{ sid: string }[]>`
      SELECT sid FROM revoked_login_session WHERE sid = 'alice-laptop'
    `;
    expect(revoked).toEqual([{ sid: 'alice-laptop' }]);
    expect(isLoginSessionBlocked('alice-laptop')).toBe(true);
  });

  it('still writes the session it is told to keep', async () => {
    await destroyUserLoginSessions(ALICE, 'alice-phone');
    await prisma.$executeRaw`
      UPDATE session SET sess = ${JSON.stringify({ userId: ALICE, kept: true })}::json
      WHERE sid = 'alice-phone'
    `;
    const rows = await prisma.$queryRaw<{ sess: unknown }[]>`
      SELECT sess FROM session WHERE sid = 'alice-phone'
    `;
    expect(rows).toHaveLength(1);
    expect(await sidsFor(ALICE)).toEqual(['alice-phone']);
  });
});
