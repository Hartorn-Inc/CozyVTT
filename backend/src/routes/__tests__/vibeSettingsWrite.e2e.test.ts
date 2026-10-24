/**
 * Campaign PUT and vibe PUT share one vibe schema.
 *
 * An illegal stored vibe still loads on GET; the next write that sends those
 * settings is 400. Duplicate names, an empty period list, and a name over 50
 * characters are refused on both routes.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
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
let dmId: string;
let campaignId: string;
let agent: ReturnType<typeof request.agent>;

const legalPeriod = { name: 'Day', hue: '#ffffff', filter: 'none', audio: null };
const legalVibe = { enabled: true, periods: [legalPeriod] };

beforeAll(async () => {
  const dm = await createTestUser({ email: `vibe-write-dm-${Date.now()}@test.cozyvtt.local`, displayName: 'VibeWrite DM' });
  dmId = dm.id;
  const campaign = await createTestCampaign(dm.id, { name: 'Vibe writes' });
  campaignId = campaign.id;
  await prisma.campaignMembership.create({ data: { userId: dmId, campaignId, role: 'DM', characterIds: [] } });
  agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: dm.email, password: TEST_PASSWORD })).status).toBe(200);
});

afterAll(async () => {
  await cleanupCampaigns([campaignId]);
  await cleanupUsers([dmId]);
  await prisma.$disconnect();
});

const campaignPut = (vibeSettings: Record<string, unknown>) =>
  agent.put(`/api/campaigns/${campaignId}`).send({ vibeSettings });
const vibePut = (vibeSettings: Record<string, unknown>) =>
  agent.put(`/api/campaigns/${campaignId}/vibe`).send({ vibeSettings });

describe('illegal vibe settings on both write routes', () => {
  it.each([
    ['duplicate period names ignoring case', {
      enabled: true,
      periods: [
        { name: 'Dawn', hue: '#FF9966', filter: 'none', audio: null },
        { name: 'dawn', hue: '#223366', filter: 'none', audio: null },
      ],
    }],
    ['an empty period list', { enabled: true, periods: [] }],
    ['a period name over 50 characters', {
      enabled: true,
      periods: [{ name: 'N'.repeat(51), hue: '#FF9966', filter: 'none', audio: null }],
    }],
  ])('refuses %s with a 400 on campaign PUT and vibe PUT', async (_label, vibeSettings) => {
    const campaignRes = await campaignPut(vibeSettings);
    expect(campaignRes.status).toBe(400);
    expect(campaignRes.body.error).toBe('Validation Error');

    const vibeRes = await vibePut(vibeSettings);
    expect(vibeRes.status).toBe(400);
    expect(vibeRes.body.error).toBe('Validation Error');
  });
});

describe('a vibe already stored that the schema would now refuse', () => {
  const illegalVibe = {
    enabled: true,
    periods: [{ name: 'N'.repeat(100), hue: '#FF9966', filter: 'none', audio: null }],
  };

  beforeEach(async () => {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { vibeSettings: illegalVibe },
    });
  });

  it('still returns that stored vibe on GET, then refuses the same settings on both PUTs', async () => {
    const getRes = await agent.get(`/api/campaigns/${campaignId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.campaign.vibeSettings).toEqual(illegalVibe);

    expect((await vibePut(illegalVibe)).status).toBe(400);
    expect((await campaignPut(illegalVibe)).status).toBe(400);
  });

  it('accepts a corrected legal vibe PUT with 200', async () => {
    const res = await vibePut(legalVibe);
    expect(res.status).toBe(200);
    const stored = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(stored.vibeSettings).toMatchObject(legalVibe);
  });
});
