/**
 * Which doors the map offers a viewer to open, close or point at.
 *
 * Doors were found by distance alone: a player could open one none of their
 * tokens could see, and a spectator was given the toggle, drawn at once on
 * their page, which the server then refused. The map now offers the DM every
 * door, a player only a door they can see (on a lit map, by the rule the
 * walls layer shows doors by; on a manual fog map, where at least one
 * perpendicular midpoint offset is in a revealed cell), and a spectator none.
 * Dynamic hit radius scaling also clamps threshold to 30% of a grid square.
 */

import { describe, it, expect } from 'vitest';
import {
  offeredDoorAt,
  doorOffered,
  doorHitRadius,
  doorMidpointNormalSamples,
  isPointInRevealedCell,
  doorVisibleThroughManualFog,
  isDoor,
} from '../doorAccess';
import type { FogState, WallSegment } from '@/types/walls';

const door: WallSegment = { id: 'd1', x1: 100, y1: 100, x2: 150, y2: 100, type: 'door-closed' };
const verticalDoor: WallSegment = { id: 'd2', x1: 300, y1: 400, x2: 300, y2: 450, type: 'door-closed' };
const wall: WallSegment = { id: 'w1', x1: 300, y1: 100, x2: 400, y2: 100, type: 'wall' };
const walls = [door, verticalDoor, wall];
const seesNothing = () => false;
const seesAll = () => true;

function makeFog(cols: number, rows: number, cellPx: number, revealedIndices: number[] = []): FogState {
  const revealed = new Array(cols * rows).fill(false);
  for (const idx of revealedIndices) {
    if (idx >= 0 && idx < revealed.length) {
      revealed[idx] = true;
    }
  }
  return { fogCols: cols, fogRows: rows, cellPx, revealed };
}

describe('doorAccess baseline rules', () => {
  it('offers the DM a door under the pointer, seen or not', () => {
    expect(offeredDoorAt(walls, 125, 102, 12, { role: 'DM', lightingEnabled: true, canSee: seesNothing })).toBe(door);
  });

  it('offers a player a door they can see, and not one they cannot, on a lit map', () => {
    expect(offeredDoorAt(walls, 125, 102, 12, { role: 'PLAYER', lightingEnabled: true, canSee: seesAll })).toBe(door);
    expect(offeredDoorAt(walls, 125, 102, 12, { role: 'PLAYER', lightingEnabled: true, canSee: seesNothing })).toBeUndefined();
  });

  it("asks whether the door's middle is seen under dynamic lighting", () => {
    const asked: Array<[number, number]> = [];
    offeredDoorAt(walls, 125, 102, 12, {
      role: 'PLAYER',
      lightingEnabled: true,
      canSee: (x, y) => {
        asked.push([x, y]);
        return true;
      },
    });
    expect(asked).toEqual([[125, 100]]);
  });

  it('offers a player any door on a map without dynamic lighting when fog is not active', () => {
    expect(offeredDoorAt(walls, 125, 102, 12, { role: 'PLAYER', lightingEnabled: false, canSee: seesNothing })).toBe(door);
  });

  it('offers a spectator no door at all', () => {
    expect(offeredDoorAt(walls, 125, 102, 12, { role: 'SPECTATOR', lightingEnabled: false, canSee: seesAll })).toBeUndefined();
  });

  it('never offers a plain wall, or a door out of reach of the pointer', () => {
    expect(offeredDoorAt(walls, 350, 102, 12, { role: 'DM', lightingEnabled: false, canSee: seesAll })).toBeUndefined();
    expect(offeredDoorAt(walls, 125, 140, 12, { role: 'DM', lightingEnabled: false, canSee: seesAll })).toBeUndefined();
  });

  it('identifies door segment types with isDoor', () => {
    expect(isDoor(door)).toBe(true);
    expect(isDoor({ ...door, type: 'door-open' })).toBe(true);
    expect(isDoor({ ...door, type: 'door-locked' })).toBe(true);
    expect(isDoor(wall)).toBe(false);
  });
});

describe('doorMidpointNormalSamples', () => {
  const gridSize = 50;

  it('calculates correct orthogonal offsets for a horizontal door', () => {
    // Midpoint: (125, 100), dx = 50, dy = 0 -> normal is (0, 1), offset is 25
    const [p1, p2] = doorMidpointNormalSamples(door, gridSize);
    expect(p1.x).toBeCloseTo(125);
    expect(p1.y).toBeCloseTo(125);
    expect(p2.x).toBeCloseTo(125);
    expect(p2.y).toBeCloseTo(75);
  });

  it('calculates correct orthogonal offsets for a vertical door', () => {
    // Midpoint: (300, 425), dx = 0, dy = 50 -> normal is (-1, 0), offset is 25
    const [p1, p2] = doorMidpointNormalSamples(verticalDoor, gridSize);
    expect(p1.x).toBeCloseTo(275);
    expect(p1.y).toBeCloseTo(425);
    expect(p2.x).toBeCloseTo(325);
    expect(p2.y).toBeCloseTo(425);
  });

  it('handles zero-length door segment safely without NaN', () => {
    const zeroDoor: WallSegment = { id: 'dz', x1: 50, y1: 50, x2: 50, y2: 50, type: 'door-closed' };
    const [p1, p2] = doorMidpointNormalSamples(zeroDoor, gridSize);
    expect(Number.isNaN(p1.x)).toBe(false);
    expect(Number.isNaN(p1.y)).toBe(false);
    expect(Number.isNaN(p2.x)).toBe(false);
    expect(Number.isNaN(p2.y)).toBe(false);
  });
});

describe('isPointInRevealedCell', () => {
  const fog = makeFog(10, 10, 50, [12]); // col 2, row 1 -> idx 12

  it('returns true when coordinate lands in revealed fogState cell', () => {
    expect(isPointInRevealedCell({ x: 125, y: 75 }, { role: 'PLAYER', lightingEnabled: false, canSee: seesAll, fogState: fog })).toBe(true);
  });

  it('returns false when coordinate lands in unrevealed fogState cell', () => {
    expect(isPointInRevealedCell({ x: 125, y: 125 }, { role: 'PLAYER', lightingEnabled: false, canSee: seesAll, fogState: fog })).toBe(false);
  });

  it('returns true when coordinate matches revealedCells index', () => {
    const viewer = {
      role: 'PLAYER',
      lightingEnabled: false,
      canSee: seesAll,
      revealedCells: new Set([12]),
      gridSize: 50,
      fogCols: 10,
      fogRows: 10,
    };
    expect(isPointInRevealedCell({ x: 125, y: 75 }, viewer)).toBe(true);
    expect(isPointInRevealedCell({ x: 125, y: 125 }, viewer)).toBe(false);
  });

  it('returns false when point is outside map bounds', () => {
    expect(isPointInRevealedCell({ x: -10, y: 50 }, { role: 'PLAYER', lightingEnabled: false, canSee: seesAll, fogState: fog })).toBe(false);
    expect(isPointInRevealedCell({ x: 800, y: 800 }, { role: 'PLAYER', lightingEnabled: false, canSee: seesAll, fogState: fog })).toBe(false);
  });
});

describe('manual fog door masking', () => {
  // Horizontal door midpoint (125, 100): normal offsets are (125, 75) [idx 12] and (125, 125) [idx 22] in 10x10 grid with cellPx=50
  const gridSize = 50;

  it('does not offer door to non-DM player when both sides are covered by unrevealed manual fog', () => {
    const hiddenFog = makeFog(10, 10, gridSize, []);
    expect(doorOffered(door, { role: 'PLAYER', lightingEnabled: false, canSee: seesAll, fogState: hiddenFog })).toBe(false);
    expect(offeredDoorAt(walls, 125, 102, 12, { role: 'PLAYER', lightingEnabled: false, canSee: seesAll, fogState: hiddenFog })).toBeUndefined();

    const emptyRevealedViewer = {
      role: 'PLAYER',
      lightingEnabled: false,
      canSee: seesAll,
      revealedCells: new Set<number>(),
      gridSize,
      fogCols: 10,
      fogRows: 10,
    };
    expect(doorOffered(door, emptyRevealedViewer)).toBe(false);
    expect(offeredDoorAt(walls, 125, 102, 12, emptyRevealedViewer)).toBeUndefined();
  });

  it('offers door to player when side 1 (midpoint - normal * offset) is revealed in fogState', () => {
    const fogSide1 = makeFog(10, 10, gridSize, [12]);
    expect(doorVisibleThroughManualFog(door, gridSize, { role: 'PLAYER', lightingEnabled: false, canSee: seesAll, fogState: fogSide1 })).toBe(true);
    expect(doorOffered(door, { role: 'PLAYER', lightingEnabled: false, canSee: seesAll, fogState: fogSide1 })).toBe(true);
    expect(offeredDoorAt(walls, 125, 102, 12, { role: 'PLAYER', lightingEnabled: false, canSee: seesAll, fogState: fogSide1 })).toBe(door);
  });

  it('offers door to player when side 2 (midpoint + normal * offset) is revealed in revealedCells', () => {
    const viewer = {
      role: 'PLAYER',
      lightingEnabled: false,
      canSee: seesAll,
      revealedCells: new Set([22]),
      gridSize,
      fogCols: 10,
      fogRows: 10,
    };
    expect(doorVisibleThroughManualFog(door, gridSize, viewer)).toBe(true);
    expect(doorOffered(door, viewer)).toBe(true);
    expect(offeredDoorAt(walls, 125, 102, 12, viewer)).toBe(door);
  });

  it('offers door when both sides are revealed', () => {
    const viewer = {
      role: 'PLAYER',
      lightingEnabled: false,
      canSee: seesAll,
      revealedCells: new Set([12, 22]),
      gridSize,
      fogCols: 10,
      fogRows: 10,
    };
    expect(doorOffered(door, viewer)).toBe(true);
  });

  it('offers door in unrevealed manual fog to DM', () => {
    const hiddenFog = makeFog(10, 10, gridSize, []);
    expect(doorOffered(door, { role: 'DM', lightingEnabled: false, canSee: seesNothing, fogState: hiddenFog })).toBe(true);
    expect(offeredDoorAt(walls, 125, 102, 12, { role: 'DM', lightingEnabled: false, canSee: seesNothing, fogState: hiddenFog })).toBe(door);
  });

  it('never offers door in revealed fog to a spectator', () => {
    const viewer = {
      role: 'SPECTATOR',
      lightingEnabled: false,
      canSee: seesAll,
      revealedCells: new Set([12, 22]),
      gridSize,
      fogCols: 10,
      fogRows: 10,
    };
    expect(doorOffered(door, viewer)).toBe(false);
    expect(offeredDoorAt(walls, 125, 102, 12, viewer)).toBeUndefined();
  });

  it('evaluates vertical door orthogonal offsets', () => {
    // verticalDoor midpoint (300, 425): normal offsets are (275, 425) [idx 85] and (325, 425) [idx 86]
    const viewerHidden = {
      role: 'PLAYER',
      lightingEnabled: false,
      canSee: seesAll,
      revealedCells: new Set([12]),
      gridSize,
      fogCols: 10,
      fogRows: 10,
    };
    expect(doorOffered(verticalDoor, viewerHidden)).toBe(false);

    const viewerRevealed = {
      role: 'PLAYER',
      lightingEnabled: false,
      canSee: seesAll,
      revealedCells: new Set([85]),
      gridSize,
      fogCols: 10,
      fogRows: 10,
    };
    expect(doorOffered(verticalDoor, viewerRevealed)).toBe(true);
    expect(offeredDoorAt(walls, 301, 425, 12, viewerRevealed)).toBe(verticalDoor);
  });

  it('enforces both dynamic lighting LOS and manual fog when both are active', () => {
    const fogSide1 = makeFog(10, 10, gridSize, [12]);
    const hiddenFog = makeFog(10, 10, gridSize, []);

    // Seen by lighting AND revealed in fog -> offered
    expect(doorOffered(door, { role: 'PLAYER', lightingEnabled: true, canSee: seesAll, fogState: fogSide1 })).toBe(true);

    // Seen by lighting BUT unrevealed in fog -> refused
    expect(doorOffered(door, { role: 'PLAYER', lightingEnabled: true, canSee: seesAll, fogState: hiddenFog })).toBe(false);

    // Not seen by lighting BUT revealed in fog -> refused
    expect(doorOffered(door, { role: 'PLAYER', lightingEnabled: true, canSee: seesNothing, fogState: fogSide1 })).toBe(false);

    // Neither seen by lighting nor revealed in fog -> refused
    expect(doorOffered(door, { role: 'PLAYER', lightingEnabled: true, canSee: seesNothing, fogState: hiddenFog })).toBe(false);
  });
});

describe('doorHitRadius dynamic scaling', () => {
  it('scales proportionally at high zoom', () => {
    // zoom 2: 18 / 2 = 9 < 50 * 0.3 = 15 -> 9
    expect(doorHitRadius(2, 50)).toBeCloseTo(9);
    // zoom 3: 18 / 3 = 6 < 50 * 0.3 = 15 -> 6
    expect(doorHitRadius(3, 50)).toBeCloseTo(6);
  });

  it('clamps to 30% of gridSize at low / fit-to-screen zoom', () => {
    // zoom 1: 18 / 1 = 18 > 50 * 0.3 = 15 -> 15
    expect(doorHitRadius(1, 50)).toBeCloseTo(15);
    // zoom 0.5: 18 / 0.5 = 36 > 15 -> 15
    expect(doorHitRadius(0.5, 50)).toBeCloseTo(15);
    // zoom 0.1 (fit-to-screen): 18 / 0.1 = 180 > 15 -> 15
    expect(doorHitRadius(0.1, 50)).toBeCloseTo(15);
  });

  it('respects custom grid size bounds', () => {
    // gridSize 100: bounds = 30
    expect(doorHitRadius(1, 100)).toBeCloseTo(18); // 18 < 30
    expect(doorHitRadius(0.2, 100)).toBeCloseTo(30); // 90 > 30 -> 30
  });

  it('handles non-positive zoom safely without division by zero', () => {
    expect(doorHitRadius(0, 50)).toBeCloseTo(15);
    expect(doorHitRadius(-1, 50)).toBeCloseTo(15);
  });

  it('integrates with offeredDoorAt at low zoom to prevent full-cell click expansion', () => {
    const lowZoom = 0.1;
    const gridSize = 50;
    const radius = doorHitRadius(lowZoom, gridSize); // 15px

    const viewer = { role: 'PLAYER', lightingEnabled: false, canSee: seesAll };

    // Click at distance 12px from door segment (125, 112) vs door at y=100 -> within 15px
    expect(offeredDoorAt(walls, 125, 112, radius, viewer)).toBe(door);

    // Click at distance 20px from door segment (125, 120) -> outside 15px radius, even though 18 / 0.1 = 180
    expect(offeredDoorAt(walls, 125, 120, radius, viewer)).toBeUndefined();
  });
});
