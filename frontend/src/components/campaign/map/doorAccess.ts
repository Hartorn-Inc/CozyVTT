// ============================================
// Which doors the map offers a viewer: to open or close with a click or the
// door menu, and to point at. The server refuses the rest (wall:update), so
// this only keeps a page from drawing a change that would be undone.
//
// Pure: no React, no canvas.
// ============================================

import type { FogState, WallSegment } from '@/types/walls';
import { distToSegment } from './mapGeometry';

export interface DoorViewer {
  /** The viewer's role in the campaign. */
  role: string | null | undefined;
  lightingEnabled: boolean;
  /** Whether the viewer makes out a point, by the shared visibility rule. */
  canSee: (x: number, y: number) => boolean;
  /** Full manual fog state (DM view or preview). */
  fogState?: FogState | null;
  /** Revealed manual fog cell indices (player view). null/undefined when fog is off. */
  revealedCells?: ReadonlySet<number> | Set<number> | null;
  /** Grid cell size in map pixels. Defaults to fogState.cellPx or 50. */
  gridSize?: number;
  /** Fog column count. Defaults to fogState.fogCols or 10. */
  fogCols?: number;
  /** Fog row count. Defaults to fogState.fogRows or 10. */
  fogRows?: number;
  /** Explored memory cells (if any). */
  exploredCells?: ReadonlySet<number> | Set<number> | null;
}

export function isDoor(segment: WallSegment): boolean {
  return segment.type === 'door-closed' || segment.type === 'door-open' || segment.type === 'door-locked';
}

/**
 * Samples two points perpendicularly displaced by half a grid square from the door segment's midpoint.
 */
export function doorMidpointNormalSamples(
  door: Pick<WallSegment, 'x1' | 'y1' | 'x2' | 'y2'>,
  gridSize: number
): [{ x: number; y: number }, { x: number; y: number }] {
  const mx = (door.x1 + door.x2) / 2;
  const my = (door.y1 + door.y2) / 2;
  const dx = door.x2 - door.x1;
  const dy = door.y2 - door.y1;
  const len = Math.hypot(dx, dy);
  const offset = gridSize / 2;
  const nx = len === 0 ? 0 : -dy / len;
  const ny = len === 0 ? 1 : dx / len;
  return [
    { x: mx + nx * offset, y: my + ny * offset },
    { x: mx - nx * offset, y: my - ny * offset },
  ];
}

/**
 * Determines whether a given map-pixel coordinate falls inside a revealed manual fog cell.
 */
export function isPointInRevealedCell(
  pt: { x: number; y: number },
  viewer: DoorViewer
): boolean {
  const cellPx = viewer.fogState?.cellPx ?? viewer.gridSize ?? 50;
  const cols = viewer.fogCols ?? viewer.fogState?.fogCols ?? 10;
  const rows = viewer.fogRows ?? viewer.fogState?.fogRows ?? 10;
  if (cols <= 0 || rows <= 0 || cellPx <= 0) return false;

  const col = Math.floor(pt.x / cellPx);
  const row = Math.floor(pt.y / cellPx);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return false;

  const idx = row * cols + col;
  if (viewer.revealedCells && viewer.revealedCells.has(idx)) return true;
  if (viewer.exploredCells && viewer.exploredCells.has(idx)) return true;
  if (viewer.fogState?.revealed) {
    if (Array.isArray(viewer.fogState.revealed) && viewer.fogState.revealed[idx]) return true;
    if (typeof (viewer.fogState.revealed as unknown as { has?: (i: number) => boolean }).has === 'function') {
      if ((viewer.fogState.revealed as unknown as Set<number>).has(idx)) return true;
    }
  }
  return false;
}

/**
 * Checks if at least one perpendicular midpoint sample of the door lies in a revealed fog cell.
 */
export function doorVisibleThroughManualFog(
  door: Pick<WallSegment, 'x1' | 'y1' | 'x2' | 'y2'>,
  gridSize: number,
  viewer: DoorViewer
): boolean {
  const [p1, p2] = doorMidpointNormalSamples(door, gridSize);
  return isPointInRevealedCell(p1, viewer) || isPointInRevealedCell(p2, viewer);
}

/**
 * Dynamic door hit threshold in map pixels.
 * Scales with zoom (18 / zoom) but is capped at 30% of a grid square
 * so low zoom levels (fit-to-screen) do not expand door click areas across full grid cells.
 */
export function doorHitRadius(zoom: number, gridSize = 50): number {
  const safeZoom = zoom > 0 ? zoom : 1;
  const safeGrid = gridSize || 50;
  return Math.min(18 / safeZoom, safeGrid * 0.3);
}

/**
 * Whether the map offers this viewer a door. The DM any door. A player only
 * a door they can see: on a lit map, where its middle is seen by the rule the
 * walls layer shows doors by; on a map with manual fog, where at least one
 * orthogonal normal offset (midpoint ± normal * gridSize / 2) is revealed;
 * on any other map, every door. A spectator none, since spectators change nothing at the table.
 */
export function doorOffered(door: WallSegment, viewer: DoorViewer): boolean {
  if (viewer.role === 'DM') return true;
  if (viewer.role !== 'PLAYER') return false;
  if (viewer.lightingEnabled && !viewer.canSee((door.x1 + door.x2) / 2, (door.y1 + door.y2) / 2)) {
    return false;
  }
  const fogActive = viewer.revealedCells != null || viewer.fogState != null;
  if (fogActive) {
    const gridSize = viewer.gridSize ?? viewer.fogState?.cellPx ?? 50;
    if (!doorVisibleThroughManualFog(door, gridSize, viewer)) {
      return false;
    }
  }
  return true;
}

/** The door within `threshold` map pixels of a point that the map offers this viewer, if any. */
export function offeredDoorAt(
  walls: readonly WallSegment[],
  x: number,
  y: number,
  threshold: number,
  viewer: DoorViewer
): WallSegment | undefined {
  return walls.find((s) => isDoor(s) && distToSegment(x, y, s) <= threshold && doorOffered(s, viewer));
}
