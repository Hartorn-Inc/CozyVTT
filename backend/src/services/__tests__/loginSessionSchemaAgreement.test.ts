/**
 * Revocation deletes the session row Express reads.
 *
 * connect-pg-simple used to be given DATABASE_URL as written, so pg ignored
 * `?schema=` and stored sign-ins in public.session while Prisma's raw DELETE
 * followed search_path. A password change then left the other devices signed
 * in. The session pool is built from databaseConnectionSettings; this file
 * writes a row the way the store writes it in an isolated schema and checks
 * that destroyUserLoginSessions removes that same row.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import type { Pool } from 'pg';
import type session from 'express-session';
import { Client } from 'pg';
import { createIsolatedSchema, type IsolatedSchema } from '../../__tests__/helpers/isolatedSchema';
import { databaseConnectionSettings } from '../../config/prismaClient';

jest.setTimeout(60000);

const SCHEMA = 'login_session_schema_agree_test';
const savedUrl = process.env.DATABASE_URL;
if (!savedUrl) throw new Error('This test needs DATABASE_URL');

let isolated: IsolatedSchema;
let destroyUserLoginSessions: typeof import('../sessionStore').destroyUserLoginSessions;
let sessionPool: Pool;
let sessionConfig: session.SessionOptions;
let loginSessionRevocationGuard: Promise<void>;
let db: import('@prisma/client').PrismaClient;

function setSession(sid: string, sess: session.SessionData): Promise<void> {
  const store = sessionConfig.store;
  if (!store) throw new Error('the session store was not configured');
  return new Promise((resolve, reject) => {
    store.set(sid, sess, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

beforeAll(async () => {
  isolated = createIsolatedSchema(SCHEMA);
  process.env.DATABASE_URL = isolated.url;
  ({ destroyUserLoginSessions } = require('../sessionStore') as typeof import('../sessionStore'));
  ({ sessionPool, sessionConfig, loginSessionRevocationGuard } = require('../../config/session') as typeof import('../../config/session'));
  await loginSessionRevocationGuard;
  const { createPrismaClient } = require('../../config/prismaClient') as typeof import('../../config/prismaClient');
  db = createPrismaClient(isolated.url);
});

afterAll(async () => {
  const store = sessionConfig.store as { close?: () => Promise<void> } | undefined;
  if (store?.close) await store.close();
  if (!sessionPool.ending) await sessionPool.end();
  await db.$disconnect();
  process.env.DATABASE_URL = savedUrl;
  isolated.drop();
});

it('builds the session pool from databaseConnectionSettings for the named schema', () => {
  const expected = databaseConnectionSettings(isolated.url);
  expect(sessionPool.options.options).toBe(expected.pool.options);
  expect(expected.schema).toBe(SCHEMA);
});

it('deletes the row connect-pg-simple wrote in the isolated schema, not a public.session stand-in', async () => {
  const user = await db.user.create({
    data: {
      email: 'schema-agree@test.cozyvtt.local',
      passwordHash: 'not-used',
      displayName: 'Schema Agree',
    },
  });
  const userId = user.id;
  const sid = 'schema-agree-sid';
  await setSession(sid, {
    cookie: {
      originalMaxAge: 3_600_000,
      expires: new Date(Date.now() + 3_600_000),
      httpOnly: true,
      path: '/',
    },
    userId,
    loginSessionEpoch: user.loginSessionEpoch,
  });

  const client = new Client({ connectionString: savedUrl });
  await client.connect();
  try {
    const inSchema = await client.query<{ sid: string }>(
      `SELECT sid FROM "${SCHEMA}".session WHERE sid = $1`,
      [sid]
    );
    expect(inSchema.rows).toEqual([{ sid }]);
    const inPublic = await client.query<{ sid: string }>(
      `SELECT sid FROM public.session WHERE sid = $1`,
      [sid]
    );
    expect(inPublic.rows).toEqual([]);

    expect(await destroyUserLoginSessions(userId, undefined, db)).toBe(1);

    const after = await client.query<{ sid: string }>(
      `SELECT sid FROM "${SCHEMA}".session WHERE sid = $1`,
      [sid]
    );
    expect(after.rows).toEqual([]);

    await setSession(sid, {
      cookie: {
        originalMaxAge: 3_600_000,
        expires: new Date(Date.now() + 3_600_000),
        httpOnly: true,
        path: '/',
      },
      userId,
      loginSessionEpoch: user.loginSessionEpoch,
    });
    const afterSet = await client.query<{ sid: string }>(
      `SELECT sid FROM "${SCHEMA}".session WHERE sid = $1`,
      [sid]
    );
    expect(afterSet.rows).toEqual([]);
  } finally {
    await client.end();
  }
});
