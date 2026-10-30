import { randomUUID } from 'crypto';
import { prisma } from '../../config/database';
import { toJson } from '../../utils/prisma-json';
import { createWsTestServer, waitForEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import type { FogState, WallSegment } from '../../types/walls';
import {
  doorMidpointNormalSamples,
  doorVisibleThroughManualFog,
  isPointInRevealedOrExploredCell,
} from '../handlers/walls';

jest.setTimeout(25000);

const runId = randomUUID().slice(0, 8);
let server: WsTestServer;
let dmId: string;
let playerId: string;
let campaignId: string;
let dmCookie: string;
let playerCookie: string;

function makeFog(cols: number, rows: number, cellPx: number, revealedIndices: number[] = []): FogState {
  const revealed = new Array(cols * rows).fill(false);
  for (const idx of revealedIndices) {
    if (idx >= 0 && idx < revealed.length) {
      revealed[idx] = true;
    }
  }
  return { fogCols: cols, fogRows: rows, cellPx, revealed };
}

describe('doorMidpointNormalSamples & fog cell visibility unit tests', () => {
  const gridSize = 50;
  const fog = makeFog(10, 10, gridSize, [12]); // cell (col=2, row=1) is index 12 (1 * 10 + 2)

  it('calculates correct perpendicular samples for a horizontal door', () => {
    // Horizontal door along y = 100 from x = 100 to x = 150 (midpoint: 125, 100)
    const door: WallSegment = { id: 'd1', x1: 100, y1: 100, x2: 150, y2: 100, type: 'door-closed' };
    const [p1, p2] = doorMidpointNormalSamples(door, gridSize);

    expect(p1.x).toBeCloseTo(125);
    expect(p1.y).toBeCloseTo(125); // displaced down into row 2
    expect(p2.x).toBeCloseTo(125);
    expect(p2.y).toBeCloseTo(75);  // displaced up into row 1
  });

  it('calculates correct perpendicular samples for a vertical door', () => {
    // Vertical door along x = 300 from y = 400 to y = 450 (midpoint: 300, 425)
    const door: WallSegment = { id: 'd2', x1: 300, y1: 400, x2: 300, y2: 450, type: 'door-closed' };
    const [p1, p2] = doorMidpointNormalSamples(door, gridSize);

    expect(p1.x).toBeCloseTo(275); // displaced left into col 5
    expect(p1.y).toBeCloseTo(425);
    expect(p2.x).toBeCloseTo(325); // displaced right into col 6
    expect(p2.y).toBeCloseTo(425);
  });

  it('handles zero-length door segment safely without NaN', () => {
    const door: WallSegment = { id: 'd0', x1: 100, y1: 100, x2: 100, y2: 100, type: 'door-closed' };
    const [p1, p2] = doorMidpointNormalSamples(door, gridSize);
    expect(Number.isNaN(p1.x)).toBe(false);
    expect(Number.isNaN(p1.y)).toBe(false);
    expect(Number.isNaN(p2.x)).toBe(false);
    expect(Number.isNaN(p2.y)).toBe(false);
  });

  it('identifies revealed and unrevealed cells correctly', () => {
    // pInRevealed: col=2, row=1 -> (125, 75)
    expect(isPointInRevealedOrExploredCell({ x: 125, y: 75 }, fog)).toBe(true);
    // pInHidden: col=2, row=2 -> (125, 125)
    expect(isPointInRevealedOrExploredCell({ x: 125, y: 125 }, fog)).toBe(false);
    // outside map
    expect(isPointInRevealedOrExploredCell({ x: -10, y: 50 }, fog)).toBe(false);
    expect(isPointInRevealedOrExploredCell({ x: 1000, y: 1000 }, fog)).toBe(false);
  });

  it('authorizes door visibility when at least one side is revealed in manual fog', () => {
    // Horizontal door at y = 100 between x = 100 and x = 150
    // P1 = (125, 125) [hidden], P2 = (125, 75) [revealed in row 1, col 2]
    const door: WallSegment = { id: 'd1', x1: 100, y1: 100, x2: 150, y2: 100, type: 'door-closed' };
    expect(doorVisibleThroughManualFog(door, gridSize, fog)).toBe(true);
  });

  it('authorizes door visibility when one side is in explored memory', () => {
    const emptyFog = makeFog(10, 10, gridSize, []);
    const exploredFog = makeFog(10, 10, gridSize, [12]);
    const door: WallSegment = { id: 'd1', x1: 100, y1: 100, x2: 150, y2: 100, type: 'door-closed' };
    expect(doorVisibleThroughManualFog(door, gridSize, emptyFog, exploredFog)).toBe(true);
  });

  it('refuses door visibility when both sides are covered by unrevealed fog', () => {
    const door: WallSegment = { id: 'd_hidden', x1: 350, y1: 350, x2: 400, y2: 350, type: 'door-closed' };
    expect(doorVisibleThroughManualFog(door, gridSize, fog)).toBe(false);
  });
});

describe('door toggle manual fog authorization (websocket integration)', () => {
  beforeAll(async () => {
    const dm = await prisma.user.create({
      data: { email: `walls-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Walls DM' },
    });
    const player = await prisma.user.create({
      data: { email: `walls-pl-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Walls Player' },
    });
    dmId = dm.id;
    playerId = player.id;
    campaignId = (
      await prisma.campaign.create({ data: { name: `Walls ${runId}`, ownerId: dmId, vibeSettings: {}, status: 'ACTIVE' } })
    ).id;
    await prisma.campaignMembership.createMany({
      data: [
        { userId: dmId, campaignId, role: 'DM', characterIds: [] },
        { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
      ],
    });
    server = await createWsTestServer();
    dmCookie = await server.loginAs(dmId);
    playerCookie = await server.loginAs(playerId);
  });

  afterAll(async () => {
    await server?.close();
    await prisma.campaign.updateMany({ where: { id: campaignId }, data: { currentMapId: null } });
    await prisma.mapExploration.deleteMany({ where: { map: { campaignId } } });
    await prisma.map.deleteMany({ where: { campaignId } });
    await prisma.campaign.deleteMany({ where: { id: campaignId } });
    await prisma.user.deleteMany({ where: { id: { in: [dmId, playerId] } } });
    await prisma.$disconnect();
  });

  const storedDoorType = async (mapId: string, doorId: string) => {
    const map = await prisma.map.findUniqueOrThrow({ where: { id: mapId } });
    const walls = map.wallSegments as unknown as WallSegment[];
    return walls.find((w) => w.id === doorId)?.type;
  };

  it('refuses player door toggle when both sides of the door are unrevealed in manual fog', async () => {
    const door: WallSegment = { id: randomUUID(), x1: 200, y1: 200, x2: 250, y2: 200, type: 'door-closed' };
    const fogData = makeFog(10, 10, 50, []); // all hidden
    const map = await prisma.map.create({
      data: {
        campaignId,
        name: 'Fog Map',
        imageUrl: '/api/assets/maps/x',
        baseLayerUrl: '/api/assets/maps/x',
        width: 10,
        height: 10,
        gridSize: 50,
        lightingEnabled: false,
        fogEnabled: true,
        fogData: toJson(fogData),
        wallSegments: toJson([door]),
        lights: toJson([]),
        tokens: toJson([]),
        annotations: [],
      },
    });
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: map.id } });

    const player = await server.connectAndAuth(playerCookie, campaignId);
    const refused = waitForEvent<{ message: string }>(player, 'error');
    const back = waitForEvent<{ segment: WallSegment }>(player, 'wall:updated');

    player.emit('wall:update', { mapId: map.id, segment: { ...door, type: 'door-open' } });

    expect((await refused).message).toBe('You cannot see that door');
    expect((await back).segment).toEqual(door);
    expect(await storedDoorType(map.id, door.id)).toBe('door-closed');
    player.disconnect();
  });

  it('allows player door toggle when at least one side is in a revealed fog cell', async () => {
    // Door midpoint is at (225, 200). Normal samples are (225, 225) [row 4, col 4 -> index 44] and (225, 175) [row 3, col 4 -> index 34]
    const door: WallSegment = { id: randomUUID(), x1: 200, y1: 200, x2: 250, y2: 200, type: 'door-closed' };
    const fogData = makeFog(10, 10, 50, [34]); // row 3, col 4 revealed
    const map = await prisma.map.create({
      data: {
        campaignId,
        name: 'Revealed Fog Map',
        imageUrl: '/api/assets/maps/x',
        baseLayerUrl: '/api/assets/maps/x',
        width: 10,
        height: 10,
        gridSize: 50,
        lightingEnabled: false,
        fogEnabled: true,
        fogData: toJson(fogData),
        wallSegments: toJson([door]),
        lights: toJson([]),
        tokens: toJson([]),
        annotations: [],
      },
    });
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: map.id } });

    const player = await server.connectAndAuth(playerCookie, campaignId);
    const opened = waitForEvent<{ segment: WallSegment }>(player, 'wall:updated');

    player.emit('wall:update', { mapId: map.id, segment: { ...door, type: 'door-open' } });

    expect((await opened).segment.type).toBe('door-open');
    expect(await storedDoorType(map.id, door.id)).toBe('door-open');
    player.disconnect();
  });

  it('allows player door toggle when one side is in explored memory', async () => {
    const door: WallSegment = { id: randomUUID(), x1: 200, y1: 200, x2: 250, y2: 200, type: 'door-closed' };
    const fogData = makeFog(10, 10, 50, []); // manual fog hidden
    const exploredData = makeFog(10, 10, 50, [44]); // explored on side P1 (row 4, col 4)

    const map = await prisma.map.create({
      data: {
        campaignId,
        name: 'Explored Fog Map',
        imageUrl: '/api/assets/maps/x',
        baseLayerUrl: '/api/assets/maps/x',
        width: 10,
        height: 10,
        gridSize: 50,
        lightingEnabled: false,
        fogEnabled: true,
        explorationEnabled: true,
        fogData: toJson(fogData),
        wallSegments: toJson([door]),
        lights: toJson([]),
        tokens: toJson([]),
        annotations: [],
      },
    });
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: map.id } });
    await prisma.mapExploration.create({
      data: {
        mapId: map.id,
        userId: playerId,
        explored: toJson(exploredData),
      },
    });

    const player = await server.connectAndAuth(playerCookie, campaignId);
    const opened = waitForEvent<{ segment: WallSegment }>(player, 'wall:updated');

    player.emit('wall:update', { mapId: map.id, segment: { ...door, type: 'door-open' } });

    expect((await opened).segment.type).toBe('door-open');
    expect(await storedDoorType(map.id, door.id)).toBe('door-open');
    player.disconnect();
  });

  it('allows DM to bypass manual fog restrictions and toggle unrevealed doors', async () => {
    const door: WallSegment = { id: randomUUID(), x1: 200, y1: 200, x2: 250, y2: 200, type: 'door-closed' };
    const fogData = makeFog(10, 10, 50, []); // all hidden
    const map = await prisma.map.create({
      data: {
        campaignId,
        name: 'DM Fog Map',
        imageUrl: '/api/assets/maps/x',
        baseLayerUrl: '/api/assets/maps/x',
        width: 10,
        height: 10,
        gridSize: 50,
        lightingEnabled: false,
        fogEnabled: true,
        fogData: toJson(fogData),
        wallSegments: toJson([door]),
        lights: toJson([]),
        tokens: toJson([]),
        annotations: [],
      },
    });
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: map.id } });

    const dm = await server.connectAndAuth(dmCookie, campaignId);
    const opened = waitForEvent<{ segment: WallSegment }>(dm, 'wall:updated');

    dm.emit('wall:update', { mapId: map.id, segment: { ...door, type: 'door-open' } });

    expect((await opened).segment.type).toBe('door-open');
    expect(await storedDoorType(map.id, door.id)).toBe('door-open');
    dm.disconnect();
  });

  it('does not leak that an unrevealed door is locked when clicked through fog', async () => {
    const door: WallSegment = { id: randomUUID(), x1: 200, y1: 200, x2: 250, y2: 200, type: 'door-locked' };
    const fogData = makeFog(10, 10, 50, []); // all hidden
    const map = await prisma.map.create({
      data: {
        campaignId,
        name: 'Locked Fog Map',
        imageUrl: '/api/assets/maps/x',
        baseLayerUrl: '/api/assets/maps/x',
        width: 10,
        height: 10,
        gridSize: 50,
        lightingEnabled: false,
        fogEnabled: true,
        fogData: toJson(fogData),
        wallSegments: toJson([door]),
        lights: toJson([]),
        tokens: toJson([]),
        annotations: [],
      },
    });
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: map.id } });

    const player = await server.connectAndAuth(playerCookie, campaignId);
    const refused = waitForEvent<{ message: string }>(player, 'error');

    player.emit('wall:update', { mapId: map.id, segment: { ...door, type: 'door-open' } });

    // Must return 'You cannot see that door', NOT 'That door is locked'
    expect((await refused).message).toBe('You cannot see that door');
    player.disconnect();
  });

  it('maintains dynamic lighting line-of-sight checks when both lighting and fog are enabled', async () => {
    // Door is in a revealed fog square (34), but behind a wall from the player token in dynamic lighting
    const divider: WallSegment = { id: randomUUID(), x1: 150, y1: 0, x2: 150, y2: 500, type: 'wall' };
    const door: WallSegment = { id: randomUUID(), x1: 200, y1: 200, x2: 250, y2: 200, type: 'door-closed' };
    const fogData = makeFog(10, 10, 50, [34]); // revealed in fog
    const map = await prisma.map.create({
      data: {
        campaignId,
        name: 'Lit And Fog Map',
        imageUrl: '/api/assets/maps/x',
        baseLayerUrl: '/api/assets/maps/x',
        width: 10,
        height: 10,
        gridSize: 50,
        lightingEnabled: true,
        globalIllumination: true,
        fogEnabled: true,
        fogData: toJson(fogData),
        wallSegments: toJson([divider, door]),
        lights: toJson([]),
        tokens: toJson([{
          id: 'p-token',
          name: 'Hero',
          imageUrl: '',
          position: { x: 1, y: 4 },
          size: { width: 1, height: 1 },
          layer: 'token',
          visible: true,
          controlledBy: playerId,
          rotation: 0,
          conditions: [],
          metadata: {},
        }]),
        annotations: [],
      },
    });
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: map.id } });

    const player = await server.connectAndAuth(playerCookie, campaignId);
    const refused = waitForEvent<{ message: string }>(player, 'error');

    player.emit('wall:update', { mapId: map.id, segment: { ...door, type: 'door-open' } });

    expect((await refused).message).toBe('You cannot see that door');
    player.disconnect();
  });
});
