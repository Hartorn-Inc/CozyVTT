/**
 * Two administrators acting at the same moment cannot leave the instance with
 * none.
 *
 * Each path that takes an administrator away (giving up the role, deleting
 * one's own account, an administrator deleting another) counted the other
 * administrators and then wrote, as two separate steps. Two of them at once
 * each counted the other, both went ahead, and nobody could reach the Admin
 * Panel again. The count and the write are now one serializable transaction,
 * so the second one sees the first and is refused.
 *
 * "The other administrators" is a count over every account, which the shared
 * test database fills with admins from other files, so this runs on a schema
 * of its own (helpers/isolatedSchema). The count is held back a moment after
 * it answers, which is the window two real requests can overlap in; without
 * the transaction both then read the other administrator and both go ahead.
 *
 * A fail-closed Read Committed revoke that later 409s still ends that user's
 * live sockets: the HTTP app uses memory sessions, so a raw `session` row is
 * inserted for each admin to assert gone, and sockets join `userId` on a
 * websocket test server started after the app client is set.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
import type express from 'express';
import type { Socket as ClientSocket } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../config/prismaClient';
import { createIsolatedSchema, type IsolatedSchema } from '../../__tests__/helpers/isolatedSchema';

jest.setTimeout(60000);

const PASSWORD = 'LastAdminRace1!Cozy';
const sharedUrl = process.env.DATABASE_URL;

let schema: IsolatedSchema;
let db: PrismaClient;
let app: express.Express;
let wsServer: {
  loginAs(userId: string): Promise<string>;
  connectClient(cookie: string): Promise<import('socket.io-client').Socket>;
  close(): Promise<void>;
};
let waitForEvent: typeof import('../../__tests__/helpers/websocket-test-server').waitForEvent;
// Imported once the app's client is set below: anything that imports
// config/database first would make the app use a client of its own.
let hashPassword: (password: string) => Promise<string>;

beforeAll(async () => {
  schema = createIsolatedSchema('last_admin_race_test');
  process.env.DATABASE_URL = schema.url;
  db = createPrismaClient(schema.url);
  // The app's client, which config/database.ts takes from here when it is set.
  (global as unknown as { prisma?: unknown }).prisma = db.$extends({
    query: {
      user: {
        async count({ args, query }) {
          const answer = await query(args);
          await new Promise((resolve) => setTimeout(resolve, 150));
          return answer;
        },
      },
    },
  });
  ({ hashPassword } = require('../../services/auth') as typeof import('../../services/auth'));
  const { createTestApp } = require('../../__tests__/helpers/test-app') as typeof import('../../__tests__/helpers/test-app');
  app = createTestApp();
  const { loginSessionRevocationGuard } = require('../../config/session') as typeof import('../../config/session');
  await loginSessionRevocationGuard;
  const ws = require('../../__tests__/helpers/websocket-test-server') as typeof import('../../__tests__/helpers/websocket-test-server');
  waitForEvent = ws.waitForEvent;
  wsServer = await ws.createWsTestServer();
});

afterAll(async () => {
  await wsServer.close();
  await db.$disconnect();
  schema.drop();
  process.env.DATABASE_URL = sharedUrl;
});

/** An instance with exactly two administrators, both signed in. */
async function twoAdmins() {
  await db.user.deleteMany({});
  const passwordHash = await hashPassword(PASSWORD);
  const make = (name: string) =>
    db.user.create({ data: { email: `${name}@race.test`, displayName: name, passwordHash, platformRole: 'ADMIN' } });
  const [a, b] = [await make('alice'), await make('bea')];
  const signIn = async (email: string) => {
    const agent = request.agent(app);
    expect((await agent.post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
    return agent;
  };
  return { a, b, asA: await signIn(a.email), asB: await signIn(b.email) };
}

const admins = () => db.user.count({ where: { platformRole: 'ADMIN' } });

async function insertSessionRow(userId: string, platformRole: 'USER' | 'ADMIN', sid: string) {
  await db.$executeRaw`
    INSERT INTO session (sid, sess, expire)
    VALUES (
      ${sid},
      ${JSON.stringify({
        cookie: {
          originalMaxAge: 3_600_000,
          expires: new Date(Date.now() + 3_600_000),
          httpOnly: true,
          path: '/',
        },
        userId,
        platformRole,
        signedInAt: Date.now(),
        loginSessionEpoch: 0,
      })}::json,
      NOW() + interval '1 hour'
    )
  `;
}

function expectEnding(client: ClientSocket) {
  return {
    told: waitForEvent<{ reason: string; message: string }>(client, 'campaign.access.revoked').then((told) => {
      expect(told.reason).toBe('signed-out');
      return told;
    }),
    dropped: new Promise<string>((resolve) => client.on('disconnect', (reason: string) => resolve(reason))),
  };
}

async function connectAdmins(aId: string, bId: string) {
  const [cookieA, cookieB] = await Promise.all([wsServer.loginAs(aId), wsServer.loginAs(bId)]);
  const [clientA, clientB] = await Promise.all([
    wsServer.connectClient(cookieA),
    wsServer.connectClient(cookieB),
  ]);
  return { clientA, clientB, endingA: expectEnding(clientA), endingB: expectEnding(clientB) };
}

async function sessionRowsFor(userId: string) {
  return db.$queryRaw<{ sid: string }[]>`
    SELECT sid FROM session WHERE sess->>'userId' = ${userId}
  `;
}

async function expectRevokedSocketsEnded(
  a: { id: string },
  b: { id: string },
  sockets: Awaited<ReturnType<typeof connectAdmins>>,
  messageRe?: RegExp,
) {
  const goneA = (await sessionRowsFor(a.id)).length === 0;
  const goneB = (await sessionRowsFor(b.id)).length === 0;
  // Fail-closed RC revoke ends that user's sockets; a 409 that never
  // reached destroy leaves the row and the socket.
  if (goneA) {
    const told = await sockets.endingA.told;
    expect(told.reason).toBe('signed-out');
    if (messageRe) expect(told.message).toMatch(messageRe);
    expect(await sockets.endingA.dropped).toBe('io server disconnect');
    expect(sockets.clientA.connected).toBe(false);
  } else {
    sockets.clientA.disconnect();
    void sockets.endingA.told.catch(() => undefined);
  }
  if (goneB) {
    const told = await sockets.endingB.told;
    expect(told.reason).toBe('signed-out');
    if (messageRe) expect(told.message).toMatch(messageRe);
    expect(await sockets.endingB.dropped).toBe('io server disconnect');
    expect(sockets.clientB.connected).toBe(false);
  } else {
    sockets.clientB.disconnect();
    void sockets.endingB.told.catch(() => undefined);
  }
}

it('keeps one administrator when both give up the role at once', async () => {
  const { a, b, asA, asB } = await twoAdmins();
  const sidA = `race-role-${a.id}`;
  const sidB = `race-role-${b.id}`;
  await insertSessionRow(a.id, 'ADMIN', sidA);
  await insertSessionRow(b.id, 'ADMIN', sidB);
  const sockets = await connectAdmins(a.id, b.id);

  const [first, second] = await Promise.all([
    asA.put(`/api/users/${a.id}`).send({ platformRole: 'USER' }),
    asB.put(`/api/users/${b.id}`).send({ platformRole: 'USER' }),
  ]);

  expect(await admins()).toBe(1);
  expect([first.status, second.status].sort()).toEqual([200, 409]);
  await expectRevokedSocketsEnded(a, b, sockets, /role/i);
});

it('keeps one administrator when one deletes the other while being demoted by them', async () => {
  const { a, b, asA, asB } = await twoAdmins();
  const sidA = `race-mix-${a.id}`;
  const sidB = `race-mix-${b.id}`;
  await insertSessionRow(a.id, 'ADMIN', sidA);
  await insertSessionRow(b.id, 'ADMIN', sidB);
  const sockets = await connectAdmins(a.id, b.id);

  const [deletion, demotion] = await Promise.all([
    asA.delete(`/api/users/${b.id}`),
    asB.put(`/api/users/${a.id}`).send({ platformRole: 'USER' }),
  ]);

  expect(await admins()).toBe(1);
  expect([deletion.status, demotion.status].sort()).toEqual([200, 409]);
  await expectRevokedSocketsEnded(a, b, sockets);
});

it('keeps one administrator when both delete their own accounts at once', async () => {
  const { a, b, asA, asB } = await twoAdmins();
  const sidA = `race-del-${a.id}`;
  const sidB = `race-del-${b.id}`;
  await insertSessionRow(a.id, 'ADMIN', sidA);
  await insertSessionRow(b.id, 'ADMIN', sidB);
  const sockets = await connectAdmins(a.id, b.id);

  const [first, second] = await Promise.all([
    asA.delete('/api/auth/account').send({ password: PASSWORD }),
    asB.delete('/api/auth/account').send({ password: PASSWORD }),
  ]);

  expect(await admins()).toBe(1);
  expect([first.status, second.status].sort()).toEqual([200, 409]);
  await expectRevokedSocketsEnded(a, b, sockets, /deleted/i);
});
