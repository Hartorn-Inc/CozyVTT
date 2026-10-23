/**
 * A token drop must fan out from the map as it is under the lock, not the
 * copy read before authorization.
 *
 * `token.move.end` used to load the map, await membership, write under the
 * lock, then tell players from the pre-authz snapshot. A set-current, hide,
 * or door close that committed in that await could put a token back on a
 * player's screen that opening the map would no longer send them.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../../config/database';
import { toJson, readTokens } from '../../utils/prisma-json';
import {
  createWsTestServer,
  expectNoEvent,
  WsTestServer,
} from '../../__tests__/helpers/websocket-test-server';
import * as writeAuthz from '../writeAuthz';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);
const email = (name: string) => `dropfanout-${name}-${runId}@test.cozyvtt.local`;

let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let mapA: string;
let mapB: string;
let dmCookie: string;
let playerCookie: string;

const OWN = 'token-own';
const SHOWN = 'token-shown';
const FAR = 'token-far';
const DOOR_ID = randomUUID();

const wallsOpen = [
  { id: randomUUID(), x1: 500, y1: 0, x2: 500, y2: 400, type: 'wall' },
  { id: DOOR_ID, x1: 500, y1: 400, x2: 500, y2: 550, type: 'door-open' },
  { id: randomUUID(), x1: 500, y1: 550, x2: 500, y2: 1000, type: 'wall' },
];

function token(id: string, x: number, y: number, controlledBy: string | null, visible = true) {
  return {
    id, name: id, imageUrl: '/api/assets/tokens/none',
    position: { x, y }, size: { width: 1, height: 1 },
    layer: 'token', visible, controlledBy, rotation: 0, conditions: [], metadata: {},
  };
}

async function holdPreConfirm(): Promise<{ release: () => void; waiting: Promise<void>; restore: () => void }> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => { reached = resolve; });
  const original = writeAuthz.confirmWriteAuthorization.bind(writeAuthz);
  const spy = jest.spyOn(writeAuthz, 'confirmWriteAuthorization').mockImplementationOnce(async (socket, options) => {
    reached();
    await gate;
    return original(socket, options);
  });
  return { release, waiting, restore: () => spy.mockRestore() };
}

beforeAll(async () => {
  const [dm, player] = await Promise.all(
    ['dm', 'player'].map((name) =>
      prisma.user.create({
        data: { email: email(name), passwordHash: 'not-used-by-socket-auth', displayName: `Drop fanout ${name}` },
      })
    )
  );
  dmId = dm.id;
  playerId = player.id;
  const campaign = await prisma.campaign.create({
    data: { name: `Drop fanout ${runId}`, ownerId: dmId, vibeSettings: {}, status: 'ACTIVE' },
  });
  campaignId = campaign.id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });
  const [a, b] = await Promise.all([
    prisma.map.create({
      data: {
        campaignId, name: 'Drop A', imageUrl: '/api/assets/maps/none', baseLayerUrl: '/api/assets/maps/none',
        width: 20, height: 20, gridSize: 50, annotations: [], tokens: [], lightingEnabled: false,
      },
    }),
    prisma.map.create({
      data: {
        campaignId, name: 'Drop B', imageUrl: '/api/assets/maps/none', baseLayerUrl: '/api/assets/maps/none',
        width: 20, height: 20, gridSize: 50, annotations: [], tokens: [], lightingEnabled: false,
      },
    }),
  ]);
  mapA = a.id;
  mapB = b.id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapA } });
  server = await createWsTestServer();
  [dmCookie, playerCookie] = await Promise.all([server.loginAs(dmId), server.loginAs(playerId)]);
});

afterAll(async () => {
  await server?.close();
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await prisma.map.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: { in: [dmId, playerId] } } });
  await prisma.$disconnect();
});

describe('token.move.end fan-out after a write that lands during authz', () => {
  it('does not send a drop on A after set-current to B', async () => {
    await prisma.map.update({
      where: { id: mapA },
      data: {
        lightingEnabled: false,
        tokens: toJson([token(OWN, 2, 2, playerId), token(SHOWN, 5, 5, null)]),
      },
    });
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapA } });

    const dm = await server.connectAndAuth(dmCookie, campaignId);
    const player = await server.connectAndAuth(playerCookie, campaignId);
    const held = await holdPreConfirm();

    try {
      dm.emit('token.move.end', { tokenId: SHOWN, mapId: mapA, x: 6, y: 5 });
      await held.waiting;
      await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapB } });
      const quietMove = expectNoEvent(player, 'token.moved', 800);
      const quietAppear = expectNoEvent(player, 'token:appeared', 800);
      held.release();
      await expect(quietMove).resolves.toBeUndefined();
      await expect(quietAppear).resolves.toBeUndefined();
      const stored = readTokens((await prisma.map.findUniqueOrThrow({ where: { id: mapA }, select: { tokens: true } })).tokens);
      expect(stored.find((t) => t.id === SHOWN)?.position).toEqual({ x: 6, y: 5 });
    } finally {
      held.restore();
      dm.disconnect();
      player.disconnect();
    }
  });

  it('does not send a drop of a token hidden during authz', async () => {
    await prisma.map.update({
      where: { id: mapA },
      data: {
        lightingEnabled: false,
        tokens: toJson([token(OWN, 2, 2, playerId), token(SHOWN, 5, 5, null, true)]),
      },
    });
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapA } });

    const dm = await server.connectAndAuth(dmCookie, campaignId);
    const player = await server.connectAndAuth(playerCookie, campaignId);
    const held = await holdPreConfirm();

    try {
      dm.emit('token.move.end', { tokenId: SHOWN, mapId: mapA, x: 8, y: 5 });
      await held.waiting;
      const row = await prisma.map.findUniqueOrThrow({ where: { id: mapA }, select: { tokens: true } });
      const next = readTokens(row.tokens).map((t) => (t.id === SHOWN ? { ...t, visible: false } : t));
      await prisma.map.update({ where: { id: mapA }, data: { tokens: toJson(next) } });
      const quietMove = expectNoEvent(player, 'token.moved', 800);
      const quietAppear = expectNoEvent(player, 'token:appeared', 800);
      held.release();
      await expect(quietMove).resolves.toBeUndefined();
      await expect(quietAppear).resolves.toBeUndefined();
    } finally {
      held.restore();
      dm.disconnect();
      player.disconnect();
    }
  });

  it('does not send a drop of a token a closed door now hides', async () => {
    await prisma.map.update({
      where: { id: mapA },
      data: {
        lightingEnabled: true,
        globalIllumination: true,
        gridSize: 50,
        wallSegments: toJson(wallsOpen),
        lights: toJson([]),
        tokens: toJson([token(OWN, 2, 10, playerId), token(FAR, 12, 10, null)]),
      },
    });
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapA } });

    const dm = await server.connectAndAuth(dmCookie, campaignId);
    const player = await server.connectAndAuth(playerCookie, campaignId);
    const held = await holdPreConfirm();

    try {
      dm.emit('token.move.end', { tokenId: FAR, mapId: mapA, x: 13, y: 10 });
      await held.waiting;
      await prisma.map.update({
        where: { id: mapA },
        data: { wallSegments: toJson(wallsOpen.map((w) => (w.id === DOOR_ID ? { ...w, type: 'door-closed' } : w))) },
      });
      const quietMove = expectNoEvent(player, 'token.moved', 800);
      const quietAppear = expectNoEvent(player, 'token:appeared', 800);
      held.release();
      await expect(quietMove).resolves.toBeUndefined();
      await expect(quietAppear).resolves.toBeUndefined();
    } finally {
      held.restore();
      dm.disconnect();
      player.disconnect();
    }
  });
});
