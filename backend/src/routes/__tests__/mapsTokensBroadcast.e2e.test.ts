/**
 * Live map broadcast on REST token create, update, and delete.
 *
 * REST token moves already broadcast map changes to connected clients via
 * resendIfCurrent. Creating, updating, or deleting tokens via REST must also
 * broadcast live WebSocket map data (map.changed) if and only if the map is the
 * campaign's active current map.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp } from '../../__tests__/helpers/test-app';
import {
  prisma,
  createTestUser,
  createTestCampaign,
  cleanupCampaigns,
  cleanupUsers,
  TEST_PASSWORD,
} from '../../__tests__/helpers/db';
import {
  createWsTestServer,
  expectNoEvent,
  waitForEvent,
  WsTestServer,
} from '../../__tests__/helpers/websocket-test-server';
import * as websocketShared from '../../websocket/shared';
import type { Socket as ClientSocket } from 'socket.io-client';

jest.setTimeout(30000);

const app = createTestApp();
let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let activeMapId: string;
let inactiveMapId: string;
let dm: ReturnType<typeof request.agent>;
let playerSocket: ClientSocket;
let broadcastSpy: jest.SpyInstance;

beforeAll(async () => {
  const stamp = randomUUID().slice(0, 8);
  const dmUser = await createTestUser({ email: `tb-dm-${stamp}@test.cozyvtt.local`, displayName: 'Token DM' });
  const playerUser = await createTestUser({ email: `tb-player-${stamp}@test.cozyvtt.local`, displayName: 'Token Player' });
  dmId = dmUser.id;
  playerId = playerUser.id;
  campaignId = (await createTestCampaign(dmId, { name: `Token Broadcasts ${stamp}` })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: dmId, campaignId, role: 'DM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });

  const mapData = (name: string) => ({
    campaignId,
    name,
    imageUrl: '/api/assets/maps/placeholder',
    baseLayerUrl: '/api/assets/maps/placeholder',
    width: 10,
    height: 10,
    gridSize: 50,
    annotations: [],
    tokens: [],
  });

  activeMapId = (await prisma.map.create({ data: mapData('Active Map') })).id;
  inactiveMapId = (await prisma.map.create({ data: mapData('Inactive Map') })).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: activeMapId } });

  dm = request.agent(app);
  expect((await dm.post('/api/auth/login').send({ email: dmUser.email, password: TEST_PASSWORD })).status).toBe(200);

  server = await createWsTestServer();
  broadcastSpy = jest.spyOn(websocketShared, 'broadcastMapData');
});

beforeEach(async () => {
  broadcastSpy.mockClear();
  playerSocket = await server.connectAndAuth(await server.loginAs(playerId), campaignId);
});

afterEach(() => {
  if (playerSocket?.connected) {
    playerSocket.disconnect();
  }
});

afterAll(async () => {
  broadcastSpy.mockRestore();
  await server?.close();
  await prisma.campaign.updateMany({ where: { id: campaignId }, data: { currentMapId: null } });
  await prisma.map.deleteMany({ where: { campaignId } });
  await cleanupCampaigns([campaignId]);
  await cleanupUsers([dmId, playerId]);
  await prisma.$disconnect();
});

describe('REST token mutations on current active map', () => {
  let createdTokenId: string;

  it('POST /tokens broadcasts live map data when creating a token on active map', async () => {
    const changedEvent = waitForEvent<{ mapId: string; mapData: { tokens: Array<{ id: string; name: string }> } }>(
      playerSocket,
      'map.changed'
    );

    const res = await dm.post(`/api/campaigns/${campaignId}/maps/${activeMapId}/tokens`).send({
      name: 'Active Goblin',
      position: { x: 2, y: 2 },
      size: { width: 1, height: 1 },
      layer: 'token',
      type: 'npc',
    });

    expect(res.status).toBe(201);
    createdTokenId = res.body.token.id;
    expect(createdTokenId).toBeDefined();

    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(expect.anything(), campaignId, expect.objectContaining({ id: activeMapId }));

    const event = await changedEvent;
    expect(event.mapId).toBe(activeMapId);
    expect(event.mapData.tokens.some((t) => t.id === createdTokenId && t.name === 'Active Goblin')).toBe(true);
  });

  it('PUT /tokens/:tokenId broadcasts live map data when updating a token on active map', async () => {
    const changedEvent = waitForEvent<{ mapId: string; mapData: { tokens: Array<{ id: string; name: string }> } }>(
      playerSocket,
      'map.changed'
    );

    const res = await dm.put(`/api/campaigns/${campaignId}/maps/${activeMapId}/tokens/${createdTokenId}`).send({
      name: 'Updated Goblin',
    });

    expect(res.status).toBe(200);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(expect.anything(), campaignId, expect.objectContaining({ id: activeMapId }));

    const event = await changedEvent;
    expect(event.mapId).toBe(activeMapId);
    expect(event.mapData.tokens.some((t) => t.id === createdTokenId && t.name === 'Updated Goblin')).toBe(true);
  });

  it('DELETE /tokens/:tokenId broadcasts live map data when removing a token on active map', async () => {
    const changedEvent = waitForEvent<{ mapId: string; mapData: { tokens: Array<{ id: string }> } }>(
      playerSocket,
      'map.changed'
    );

    const res = await dm.delete(`/api/campaigns/${campaignId}/maps/${activeMapId}/tokens/${createdTokenId}`);
    expect(res.status).toBe(200);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(expect.anything(), campaignId, expect.objectContaining({ id: activeMapId }));

    const event = await changedEvent;
    expect(event.mapId).toBe(activeMapId);
    expect(event.mapData.tokens.some((t) => t.id === createdTokenId)).toBe(false);
  });
});

describe('REST token mutations on prepared (inactive) map', () => {
  let inactiveTokenId: string;

  it('POST /tokens does not broadcast map data when creating a token on inactive map', async () => {
    const quiet = expectNoEvent(playerSocket, 'map.changed', 600);

    const res = await dm.post(`/api/campaigns/${campaignId}/maps/${inactiveMapId}/tokens`).send({
      name: 'Prepared Guard',
      position: { x: 1, y: 1 },
      size: { width: 1, height: 1 },
      layer: 'token',
      type: 'npc',
    });

    expect(res.status).toBe(201);
    inactiveTokenId = res.body.token.id;
    expect(inactiveTokenId).toBeDefined();

    expect(broadcastSpy).not.toHaveBeenCalled();
    await quiet;
  });

  it('PUT /tokens/:tokenId does not broadcast map data when updating a token on inactive map', async () => {
    const quiet = expectNoEvent(playerSocket, 'map.changed', 600);

    const res = await dm.put(`/api/campaigns/${campaignId}/maps/${inactiveMapId}/tokens/${inactiveTokenId}`).send({
      name: 'Prepared Elite Guard',
    });

    expect(res.status).toBe(200);
    expect(broadcastSpy).not.toHaveBeenCalled();
    await quiet;
  });

  it('DELETE /tokens/:tokenId does not broadcast map data when removing a token on inactive map', async () => {
    const quiet = expectNoEvent(playerSocket, 'map.changed', 600);

    const res = await dm.delete(`/api/campaigns/${campaignId}/maps/${inactiveMapId}/tokens/${inactiveTokenId}`);
    expect(res.status).toBe(200);
    expect(broadcastSpy).not.toHaveBeenCalled();
    await quiet;
  });
});
