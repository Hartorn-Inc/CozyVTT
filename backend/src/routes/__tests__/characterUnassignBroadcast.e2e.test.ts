/**
 * Unassign roster.updated includes campaignId — End-to-End Tests
 *
 * CampaignContext ignores roster events without data.campaignId, so an
 * unassign that omitted it left open campaign pages showing the character
 * until reload. Assign already sent campaignId; unassign now matches.
 *
 * Broadcasts are captured rather than delivered: these route tests run with
 * no Socket.io server attached. Must be named `mock*` — Jest hoists the
 * factory above the imports and forbids it referencing anything else out of
 * scope.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';

const mockBroadcasts: Array<{ campaignId: string; event: string; data: unknown }> = [];

jest.mock('../../websocket/utils', () => ({
  ...jest.requireActual('../../websocket/utils'),
  broadcastToCampaign: jest.fn((campaignId: string, event: string, data: unknown) => {
    mockBroadcasts.push({ campaignId, event, data });
  }),
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

describe('character unassign roster.updated', () => {
  let playerId: string;
  let campaignId: string;
  let playerAgent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const stamp = Date.now();
    const playerEmail = `unassign_bc_pl_${stamp}@test.invalid`;
    const player = await createTestUser({ email: playerEmail, isApproved: true });
    playerId = player.id;

    const campaign = await createTestCampaign(playerId, { name: `Unassign Broadcast ${stamp}` });
    campaignId = campaign.id;

    await prisma.campaignMembership.create({
      data: { campaignId, userId: playerId, role: 'DM', characterIds: [] },
    });

    playerAgent = request.agent(app);
    const login = await playerAgent
      .post('/api/auth/login')
      .send({ email: playerEmail, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
  });

  afterAll(async () => {
    await prisma.character.deleteMany({ where: { userId: playerId } });
    await cleanupCampaigns([campaignId]);
    await cleanupUsers([playerId]);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    mockBroadcasts.length = 0;
  });

  it('includes campaignId on character.unassigned', async () => {
    const created = await playerAgent
      .post('/api/characters')
      .send({ name: 'Unassign Broadcast' })
      .expect(201);
    const characterId: string = created.body.character.id;

    await playerAgent
      .post(`/api/characters/${characterId}/assign`)
      .send({ campaignId })
      .expect(200);

    mockBroadcasts.length = 0;

    const res = await playerAgent
      .post(`/api/characters/${characterId}/assign`)
      .send({ campaignId: null });
    expect(res.status).toBe(200);

    expect(mockBroadcasts).toContainEqual({
      campaignId,
      event: 'roster.updated',
      data: {
        action: 'character.unassigned',
        characterId,
        userId: playerId,
        campaignId,
      },
    });
  });
});
