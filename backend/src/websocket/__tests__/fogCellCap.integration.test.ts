/**
 * A fog reveal/hide names at most 20,000 cells in one message.
 *
 * The map may hold up to 250,000 squares; one `fog:operation` (and REST)
 * is capped so a single payload cannot carry a whole large grid. Over-cap
 * is refused and stores nothing; 20,000 is accepted. `reveal_all` /
 * `hide_all` send no cells array and are not under this cap. Expected
 * sizes are literals, not the production constant.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import {
  createWsTestServer,
  expectNoEvent,
  waitForEvent,
  WsTestServer,
} from '../../__tests__/helpers/websocket-test-server';

jest.setTimeout(30000);

const runId = randomUUID().slice(0, 8);
const email = (name: string) => `fogmsgcap-${name}-${runId}@test.cozyvtt.local`;

let server: WsTestServer;
let dmId: string;
let campaignId: string;
let mapId: string;
let dmCookie: string;

type ErrorEvent = { message: string };

beforeAll(async () => {
  const dm = await prisma.user.create({
    data: { email: email('dm'), passwordHash: 'not-used-by-socket-auth', displayName: 'Fog msg cap DM' },
  });
  dmId = dm.id;
  const campaign = await prisma.campaign.create({
    data: { name: `Fog msg cap ${runId}`, ownerId: dmId, vibeSettings: {} },
  });
  campaignId = campaign.id;
  await prisma.campaignMembership.create({
    data: { userId: dmId, campaignId, role: 'DM', characterIds: [] },
  });
  // 150 × 150 = 22,500 cells: large enough that 20,001 is a valid index, under
  // the 250,000 map-size ceiling so the grid itself still loads.
  const map = await prisma.map.create({
    data: {
      campaignId, name: 'Capped', imageUrl: '/api/assets/maps/none', baseLayerUrl: '/api/assets/maps/none',
      width: 150, height: 150, gridSize: 50, tokens: [], annotations: [], fogEnabled: true,
    },
  });
  mapId = map.id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId } });
  server = await createWsTestServer();
  dmCookie = await server.loginAs(dmId);
});

afterAll(async () => {
  await server?.close();
  await prisma.map.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: dmId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.map.update({ where: { id: mapId }, data: { fogData: Prisma.JsonNull } });
});

describe('fog:operation cell cap', () => {
  it('refuses a 20001-cell reveal, emits error, and stores nothing', async () => {
    const dm = await server.connectAndAuth(dmCookie, campaignId);
    const error = waitForEvent<ErrorEvent>(dm, 'error');
    const noGrid = expectNoEvent(dm, 'fog:updated', 800);

    dm.emit('fog:operation', {
      mapId,
      operation: { op: 'reveal', cells: Array.from({ length: 20001 }, (_, i) => i) },
    });

    expect((await error).message).toMatch(/20000|cells per message/i);
    await noGrid;
    expect((await prisma.map.findUniqueOrThrow({ where: { id: mapId } })).fogData).toBeNull();
    dm.disconnect();
  });

  it('accepts a 20000-cell reveal', async () => {
    const dm = await server.connectAndAuth(dmCookie, campaignId);
    const seen = waitForEvent<{ mapId: string; fogState: { revealed: boolean[] } }>(dm, 'fog:updated');

    dm.emit('fog:operation', {
      mapId,
      operation: { op: 'reveal', cells: Array.from({ length: 20000 }, (_, i) => i) },
    });

    const payload = await seen;
    expect(payload.fogState.revealed[0]).toBe(true);
    expect(payload.fogState.revealed[19999]).toBe(true);
    expect(payload.fogState.revealed[20000]).toBe(false);
    const stored = (await prisma.map.findUniqueOrThrow({ where: { id: mapId } })).fogData as { revealed: boolean[] };
    expect(stored.revealed[19999]).toBe(true);
    expect(stored.revealed[20000]).toBe(false);
    dm.disconnect();
  });

  it('still accepts reveal_all with no cells array', async () => {
    const dm = await server.connectAndAuth(dmCookie, campaignId);
    const seen = waitForEvent<{ fogState: { revealed: boolean[] } }>(dm, 'fog:updated');
    dm.emit('fog:operation', { mapId, operation: { op: 'reveal_all' } });
    expect((await seen).fogState.revealed.every((v) => v === true)).toBe(true);
    dm.disconnect();
  });
});
