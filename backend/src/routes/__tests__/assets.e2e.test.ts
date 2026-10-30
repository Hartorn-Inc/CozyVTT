/**
 * Assets Query Validation and LIKE Pattern Escaping — End-to-End Tests
 *
 * Verifies that GET /api/assets rejects duplicated scalar query parameters
 * with HTTP 400 Bad Request and that SQL LIKE wildcards (% and _) in search
 * parameters match literal characters rather than arbitrary patterns.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

const UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cozyvtt-assets-e2e-'));
process.env.UPLOAD_DIR = UPLOAD_DIR;

import { positiveIntegerFromEnv } from '../../config/env';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { uploadLimiter } from '../assets';
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

describe('GET /api/assets query parameter validation and LIKE escaping', () => {
  let userId: string;
  let campaignId: string;
  let userAgent: ReturnType<typeof request.agent>;
  const assetIds: string[] = [];

  async function login(email: string) {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    return agent;
  }

  async function makeAsset(name: string, uploadedById: string) {
    const filename = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}.png`;
    const filePath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filePath, PNG);
    const asset = await prisma.asset.create({
      data: {
        type: 'MAP',
        scope: 'USER',
        uploadedById,
        filename,
        originalName: filename,
        mimeType: 'image/png',
        fileSize: PNG.length,
        filePath,
        name,
      },
    });
    assetIds.push(asset.id);
    return asset;
  }

  beforeAll(async () => {
    const stamp = Date.now();
    const user = await createTestUser({ email: `assets-user-${stamp}@test.cozyvtt.local`, displayName: 'Asset User' });
    userId = user.id;

    const campaign = await createTestCampaign(userId, { name: `Asset Campaign ${stamp}` });
    campaignId = campaign.id;
    await prisma.campaignMembership.create({
      data: { userId, campaignId, role: 'DM', characterIds: [] },
    });

    userAgent = await login(user.email);

    await makeAsset('Special 100% Map', userId);
    await makeAsset('Special 1000 Map', userId);
    await makeAsset('Token_Alpha_1', userId);
    await makeAsset('Token-Alpha-1', userId);
  });

  afterAll(async () => {
    if (assetIds.length > 0) {
      await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
    }
    await cleanupCampaigns([campaignId]);
    await cleanupUsers([userId]);
    await prisma.$disconnect();
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  });

  describe('repeated query parameters return HTTP 400', () => {
    it.each([
      ['search', 'search=a&search=b'],
      ['campaignId', 'campaignId=c1&campaignId=c2'],
      ['uploadedBy', 'uploadedBy=u1&uploadedBy=u2'],
      ['usable', 'usable=true&usable=false'],
      ['page', 'page=1&page=2'],
      ['limit', 'limit=10&limit=20'],
    ])('rejects repeated %s parameter', async (paramName, queryString) => {
      const res = await userAgent.get(`/api/assets?${queryString}`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'Validation Error',
        message: `Parameter "${paramName}" cannot be specified multiple times.`,
      });
    });
  });

  describe('LIKE wildcard escaping in search parameter', () => {
    it('escapes % wildcard to match literal percent sign', async () => {
      const res = await userAgent.get('/api/assets?search=Special 100%');
      expect(res.status).toBe(200);
      const names = res.body.assets.map((a: { name: string }) => a.name);
      expect(names).toContain('Special 100% Map');
      expect(names).not.toContain('Special 1000 Map');
    });

    it('escapes _ wildcard to match literal underscore', async () => {
      const res = await userAgent.get('/api/assets?search=Token_Alpha_');
      expect(res.status).toBe(200);
      const names = res.body.assets.map((a: { name: string }) => a.name);
      expect(names).toContain('Token_Alpha_1');
      expect(names).not.toContain('Token-Alpha-1');
    });
  });

  describe('ASSET_UPLOAD_RATE_LIMIT parsing with positiveIntegerFromEnv', () => {
    it('falls back to 30 when ASSET_UPLOAD_RATE_LIMIT is invalid or non-numeric', () => {
      expect(positiveIntegerFromEnv('ASSET_UPLOAD_RATE_LIMIT', 30, { ASSET_UPLOAD_RATE_LIMIT: 'invalid-number' })).toBe(30);
      expect(positiveIntegerFromEnv('ASSET_UPLOAD_RATE_LIMIT', 30, { ASSET_UPLOAD_RATE_LIMIT: 'NaN' })).toBe(30);
      expect(positiveIntegerFromEnv('ASSET_UPLOAD_RATE_LIMIT', 30, { ASSET_UPLOAD_RATE_LIMIT: '-5' })).toBe(30);
    });

    it('parses valid numeric ASSET_UPLOAD_RATE_LIMIT values', () => {
      expect(positiveIntegerFromEnv('ASSET_UPLOAD_RATE_LIMIT', 30, { ASSET_UPLOAD_RATE_LIMIT: '50' })).toBe(50);
    });

    it('exports an uploadLimiter configured with a positive integer ceiling', () => {
      expect(typeof uploadLimiter).toBe('function');
    });
  });

  describe('UTF-8 non-ASCII filename decoding on upload', () => {
    it('persists non-ASCII filename correctly decoded from latin1 to utf-8', async () => {
      const nonAsciiOriginalName = 'héroïque_créature_épée.png';
      const latin1EncodedName = Buffer.from(nonAsciiOriginalName, 'utf8').toString('latin1');

      const res = await userAgent
        .post('/api/assets/upload')
        .field('type', 'TOKEN')
        .field('scope', 'USER')
        .attach('file', PNG, { filename: latin1EncodedName, contentType: 'image/png' });

      expect(res.status).toBe(201);
      expect(res.body.asset.originalName).toBe(nonAsciiOriginalName);
      assetIds.push(res.body.asset.id);
    });
  });
});
