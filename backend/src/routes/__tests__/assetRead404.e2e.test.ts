/**
 * Unreadable asset metadata and bytes both answer 404.
 *
 * Metadata GET used to decide access on its own terms and 403, while the
 * map/token/download routes used `canReadAsset` and (for maps/tokens/download)
 * still 403'd. A player could load a DM's personal map that the campaign was
 * showing, then be refused its metadata — or learn an id existed from 403 vs
 * 404. Issue #50: one rule, one status, same envelope as a missing row.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import request from 'supertest';

const UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cozyvtt-asset-read404-'));
process.env.UPLOAD_DIR = UPLOAD_DIR;

import { createTestApp } from '../../__tests__/helpers/test-app';
import {
  prisma,
  createTestUser,
  createTestCampaign,
  cleanupUsers,
  cleanupCampaigns,
  TEST_PASSWORD,
} from '../../__tests__/helpers/db';

const app = createTestApp();

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154' +
    '789c6300010000050001' +
    '0d0a2db40000000049454e44ae426082',
  'hex'
);

const NOT_FOUND = { error: 'Not Found', message: 'Asset not found' };

describe('unreadable asset reads are 404', () => {
  let dmId: string;
  let playerId: string;
  let campaignId: string;
  let unusedMapId: string;
  let unusedTokenId: string;
  let inUseMapId: string;
  let orphanMapId: string;
  let mapRowId: string;

  let dm: ReturnType<typeof request.agent>;
  let player: ReturnType<typeof request.agent>;

  async function makeAsset(type: 'MAP' | 'TOKEN', label: string) {
    const filePath = path.join(UPLOAD_DIR, `${label}.png`);
    fs.writeFileSync(filePath, PNG);
    const asset = await prisma.asset.create({
      data: {
        type,
        scope: 'USER',
        uploadedById: dmId,
        filename: `${label}.png`,
        originalName: `${label}.png`,
        mimeType: 'image/png',
        fileSize: PNG.length,
        filePath,
        name: label,
      },
    });
    return asset.id;
  }

  const login = async (email: string) => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    return agent;
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const dmEmail = `read404_dm_${stamp}@test.invalid`;
    const playerEmail = `read404_pl_${stamp}@test.invalid`;

    dmId = (await createTestUser({ email: dmEmail, isApproved: true })).id;
    playerId = (await createTestUser({ email: playerEmail, isApproved: true })).id;

    campaignId = (await createTestCampaign(dmId, { name: `Asset read 404 ${stamp}` })).id;
    await prisma.campaignMembership.createMany({
      data: [
        { campaignId, userId: dmId, role: 'DM', characterIds: [] },
        { campaignId, userId: playerId, role: 'PLAYER', characterIds: [] },
      ],
    });

    unusedMapId = await makeAsset('MAP', 'private-notes-map');
    unusedTokenId = await makeAsset('TOKEN', 'private-token');
    inUseMapId = await makeAsset('MAP', 'table-battlemap');
    orphanMapId = await makeAsset('MAP', 'orphan-campaign-map');
    await prisma.asset.update({
      where: { id: orphanMapId },
      data: { scope: 'CAMPAIGN', campaignId: null },
    });

    mapRowId = (await prisma.map.create({
      data: {
        campaignId,
        name: 'The Table',
        imageUrl: `/api/assets/maps/${inUseMapId}`,
        baseLayerUrl: `/api/assets/maps/${inUseMapId}`,
        width: 10,
        height: 10,
        gridSize: 50,
        annotations: [],
        tokens: [],
      },
    })).id;
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapRowId } });

    dm = await login(dmEmail);
    player = await login(playerEmail);
  });

  afterAll(async () => {
    await prisma.map.deleteMany({ where: { campaignId } });
    await prisma.asset.deleteMany({
      where: { id: { in: [unusedMapId, unusedTokenId, inUseMapId, orphanMapId] } },
    });
    await cleanupCampaigns([campaignId]);
    await cleanupUsers([dmId, playerId]);
    await prisma.$disconnect();
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  });

  it('refuses an unused personal map with the same 404 envelope on metadata, maps, and download', async () => {
    const meta = await player.get(`/api/assets/${unusedMapId}`);
    expect(meta.status).toBe(404);
    expect(meta.body).toEqual(NOT_FOUND);

    const bytes = await player.get(`/api/assets/maps/${unusedMapId}`);
    expect(bytes.status).toBe(404);
    expect(bytes.body).toEqual({ error: 'Not Found', message: 'Map asset not found' });

    const download = await player.get(`/api/assets/${unusedMapId}/download`);
    expect(download.status).toBe(404);
    expect(download.body).toEqual(NOT_FOUND);
  });

  it('refuses an unused personal token with 404 on metadata, tokens, and download', async () => {
    const meta = await player.get(`/api/assets/${unusedTokenId}`);
    expect(meta.status).toBe(404);
    expect(meta.body).toEqual(NOT_FOUND);

    const bytes = await player.get(`/api/assets/tokens/${unusedTokenId}`);
    expect(bytes.status).toBe(404);
    expect(bytes.body).toEqual({ error: 'Not Found', message: 'Token asset not found' });

    const download = await player.get(`/api/assets/${unusedTokenId}/download`);
    expect(download.status).toBe(404);
    expect(download.body).toEqual(NOT_FOUND);
  });

  it('lets the uploader read metadata and bytes of that same unused map', async () => {
    expect((await dm.get(`/api/assets/${unusedMapId}`)).status).toBe(200);
    expect((await dm.get(`/api/assets/maps/${unusedMapId}`)).status).toBe(200);
    expect((await dm.get(`/api/assets/${unusedMapId}/download`)).status).toBe(200);
  });

  it('lets a player read both metadata and map bytes of a DM personal map the campaign is showing', async () => {
    expect((await player.get(`/api/assets/${inUseMapId}`)).status).toBe(200);
    expect((await player.get(`/api/assets/maps/${inUseMapId}`)).status).toBe(200);
    expect((await player.get(`/api/assets/${inUseMapId}/download`)).status).toBe(200);
  });

  it('answers the same 404 envelope for a missing id', async () => {
    const missing = randomUUID();
    const meta = await player.get(`/api/assets/${missing}`);
    expect(meta.status).toBe(404);
    expect(meta.body).toEqual(NOT_FOUND);
  });

  it('does not open a campaign asset whose campaign is gone to every signed-in caller', async () => {
    const meta = await player.get(`/api/assets/${orphanMapId}`);
    expect(meta.status).toBe(404);
    expect(meta.body).toEqual(NOT_FOUND);
    expect((await player.get(`/api/assets/maps/${orphanMapId}`)).status).toBe(404);
    expect((await dm.get(`/api/assets/${orphanMapId}`)).status).toBe(200);
    expect((await dm.get(`/api/assets/maps/${orphanMapId}`)).status).toBe(200);
  });
});
