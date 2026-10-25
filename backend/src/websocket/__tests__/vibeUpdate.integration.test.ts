/**
 * A stored vibe that the write schema would now refuse still loads at the
 * table: `vibe.update` switches `currentVibe` against that blob and does not
 * revalidate periods. A grandfathered 100-character period name is the spec
 * example. Extra payload keys, including a client `vibeSettings` object, must
 * not write the JSON column.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../../config/database';
import { VibeSettingsSchema } from '../../validators/campaigns';
import {
  createWsTestServer,
  waitForEvent,
  expectNoEvent,
  WsTestServer,
} from '../../__tests__/helpers/websocket-test-server';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);
const email = (name: string) => `vibeupd-${name}-${runId}@test.cozyvtt.local`;

/** Spec example: a stored name the 50-character write schema would refuse. */
const LONG_PERIOD = 'N'.repeat(100);

const illegalVibe = {
  enabled: true,
  periods: [{ name: LONG_PERIOD, hue: '#FF9966', filter: 'none', audio: null }],
};

let server: WsTestServer;
let dmId: string;
let campaignId: string;
let dmCookie: string;

beforeAll(async () => {
  expect(LONG_PERIOD).toHaveLength(100);
  expect(VibeSettingsSchema.safeParse(illegalVibe).success).toBe(false);

  dmId = (await prisma.user.create({
    data: { email: email('dm'), passwordHash: 'not-used-by-socket-auth', displayName: `VibeUpd dm` },
  })).id;

  campaignId = (await prisma.campaign.create({
    data: { name: `VibeUpd ${runId}`, ownerId: dmId, vibeSettings: illegalVibe },
  })).id;
  await prisma.campaignMembership.create({
    data: { userId: dmId, campaignId, role: 'DM', characterIds: [] },
  });

  server = await createWsTestServer();
  dmCookie = await server.loginAs(dmId);
});

beforeEach(async () => {
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { currentVibe: null, vibeSettings: illegalVibe },
  });
});

afterAll(async () => {
  await server?.close();
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: dmId } });
  await prisma.$disconnect();
});

describe('vibe.update against a stored illegal vibe', () => {
  it('switches to a 100-character period name without erroring on the stored settings', async () => {
    const dm = await server.connectAndAuth(dmCookie, campaignId);
    const updated = waitForEvent<{ period: string }>(dm, 'vibe.updated');
    const silence = expectNoEvent(dm, 'error');
    dm.emit('vibe.update', { period: LONG_PERIOD });
    expect((await updated).period).toBe(LONG_PERIOD);
    await silence;

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { currentVibe: true, vibeSettings: true },
    });
    expect(campaign.currentVibe).toBe(LONG_PERIOD);
    expect(campaign.currentVibe).toHaveLength(100);
    const stored = campaign.vibeSettings as { enabled?: boolean; periods?: Array<{ name: string }> };
    expect(stored.enabled).toBe(true);
    expect(stored.periods?.[0]?.name).toBe(LONG_PERIOD);
    dm.disconnect();
  });

  it('ignores a client vibeSettings object and does not write the JSON column from extra keys', async () => {
    const dm = await server.connectAndAuth(dmCookie, campaignId);
    const updated = waitForEvent<{ period: string }>(dm, 'vibe.updated');
    dm.emit('vibe.update', {
      period: LONG_PERIOD,
      vibeSettings: {
        enabled: false,
        periods: [{ name: 'rewritten', hue: '#000000', filter: 'none', audio: null }],
      },
    });
    expect((await updated).period).toBe(LONG_PERIOD);

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { currentVibe: true, vibeSettings: true },
    });
    expect(campaign.currentVibe).toBe(LONG_PERIOD);
    const stored = campaign.vibeSettings as {
      enabled?: boolean;
      periods?: Array<{ name: string }>;
    };
    expect(stored.enabled).toBe(true);
    expect(stored.periods?.map((p) => p.name)).toEqual([LONG_PERIOD]);
    dm.disconnect();
  });
});
