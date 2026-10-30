import request from 'supertest';

// The session routes tell the table over the socket; there is none here.
jest.mock('../../websocket/utils', () => ({
  ...jest.requireActual('../../websocket/utils'),
  broadcastToCampaign: jest.fn(),
}));

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

describe('Session start and end lifecycle guards', () => {
  let dmId: string;
  let campaignId: string;
  let dm: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const dmUser = await createTestUser({ displayName: 'Session DM' });
    dmId = dmUser.id;
    const campaign = await createTestCampaign(dmId, { name: 'Session Lifecycle Test' });
    campaignId = campaign.id;
    await prisma.campaignMembership.create({
      data: { userId: dmId, campaignId, role: 'DM', characterIds: [] },
    });
    dm = request.agent(app);
    await dm.post('/api/auth/login').send({ email: dmUser.email, password: TEST_PASSWORD });
  });

  beforeEach(async () => {
    await prisma.session.deleteMany({ where: { campaignId } });
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'INACTIVE' },
    });
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { campaignId } });
    await cleanupCampaigns([campaignId]);
    await cleanupUsers([dmId]);
    await prisma.$disconnect();
  });

  it('rejects starting a new session when campaign status is PAUSED with HTTP 400', async () => {
    const startRes = await dm.post(`/api/campaigns/${campaignId}/sessions`).send({});
    expect(startRes.status).toBe(201);
    const sessionId = startRes.body.session.id;

    const pauseRes = await dm.put(`/api/campaigns/${campaignId}/sessions/${sessionId}/pause`).send({});
    expect(pauseRes.status).toBe(200);

    const secondStartRes = await dm.post(`/api/campaigns/${campaignId}/sessions`).send({});
    expect(secondStartRes.status).toBe(400);
    expect(secondStartRes.body.message).toMatch(/already active|paused|end or resume/i);
  });

  it('rejects starting a new session when an unended session exists with endedAt == null', async () => {
    const startRes = await dm.post(`/api/campaigns/${campaignId}/sessions`).send({});
    expect(startRes.status).toBe(201);

    // Inadvertently reset campaign status to INACTIVE while session remains unended
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'INACTIVE' },
    });

    const secondStartRes = await dm.post(`/api/campaigns/${campaignId}/sessions`).send({});
    expect(secondStartRes.status).toBe(400);
    expect(secondStartRes.body.message).toMatch(/already active|unended/i);
  });

  it('preserves pre-existing savedState when ending a PAUSED session with saveState: false', async () => {
    const startRes = await dm.post(`/api/campaigns/${campaignId}/sessions`).send({});
    expect(startRes.status).toBe(201);
    const sessionId = startRes.body.session.id;

    const pauseRes = await dm.put(`/api/campaigns/${campaignId}/sessions/${sessionId}/pause`).send({});
    expect(pauseRes.status).toBe(200);

    const pausedSession = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(pausedSession.savedState).not.toBeNull();

    const endRes = await dm.put(`/api/campaigns/${campaignId}/sessions/${sessionId}/end`).send({
      saveState: false,
    });
    expect(endRes.status).toBe(200);
    expect(endRes.body.stateSaved).toBe(true);
    expect(endRes.body.message).toMatch(/preserved/i);

    const endedSession = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(endedSession.endedAt).not.toBeNull();
    expect(endedSession.savedState).toEqual(pausedSession.savedState);
  });

  it('discards state when ending an active session with saveState: false and no prior savedState', async () => {
    const startRes = await dm.post(`/api/campaigns/${campaignId}/sessions`).send({});
    expect(startRes.status).toBe(201);
    const sessionId = startRes.body.session.id;

    const endRes = await dm.put(`/api/campaigns/${campaignId}/sessions/${sessionId}/end`).send({
      saveState: false,
    });
    expect(endRes.status).toBe(200);
    expect(endRes.body.stateSaved).toBe(false);
    expect(endRes.body.message).toMatch(/without saving state/i);

    const endedSession = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(endedSession.endedAt).not.toBeNull();
    expect(endedSession.savedState).toBeNull();
  });
});
