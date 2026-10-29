// ============================================
// Manual fog-of-war layer (the non-dynamic-lighting fog).
// DM sees semi-transparent fog from the full fogState; players see opaque
// fog everywhere outside their revealed cell set: nothing under an
// unrevealed cell shows through, not the artwork and not what stands on it.
// Pure: no React, no component closures.
// ============================================

import type { FogState } from '@/types/walls';
import type { Viewport } from './types';
import { buildFogRaster, compositeFogRaster } from '../fogRaster';

export interface FogDrawState {
  isDM: boolean;
  /** Full fog grid — DM only. */
  fogState: FogState | null;
  /** Revealed cell indices — players only; null = no fog to draw. */
  revealedCells: Set<number> | null;
  /**
   * Cells left clear whatever the revealed set says — the ones a player's own
   * tokens stand on. Players always see their own tokens; the fog that covers
   * the overlay must not paint over them.
   */
  exemptCells?: ReadonlySet<number>;
  /** Per-cell reveal-fade opacity (1 = just revealed → 0 = faded in). */
  revealOpacity: ReadonlyMap<number, number>;
  /** Cached 1px-per-cell offscreen raster canvas representing base fog state. */
  raster?: HTMLCanvasElement | null;
  /** Reusable offscreen scratch canvas for dynamic compositing. */
  scratchCanvas?: HTMLCanvasElement | null;
}

export function drawFog(
  ctx: CanvasRenderingContext2D,
  state: FogDrawState,
  viewport: Viewport
): void {
  // DM fog (semi-transparent, from full fogState)
  if (state.isDM && state.fogState) {
    const { fogCols, fogRows, cellPx, revealed } = state.fogState;
    if (fogCols <= 0 || fogRows <= 0) return;
    const mapWidthPx = fogCols * cellPx;
    const mapHeightPx = fogRows * cellPx;
    const baseRaster = state.raster ?? buildFogRaster(fogCols, fogRows, true, revealed);
    const finalRaster = compositeFogRaster(
      baseRaster,
      fogCols,
      fogRows,
      true,
      undefined,
      state.revealOpacity,
      state.scratchCanvas
    );

    ctx.save();
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(finalRaster, 0, 0, mapWidthPx, mapHeightPx);
    ctx.imageSmoothingEnabled = prevSmoothing;
    ctx.restore();
  }

  // Player fog (opaque, from revealedCells; cells are one per grid square)
  if (!state.isDM && state.revealedCells) {
    const cellPx = viewport.gridSize;
    const fogCols = viewport.mapWidth;
    const fogRows = viewport.mapHeight;
    if (fogCols <= 0 || fogRows <= 0) return;
    const mapWidthPx = fogCols * cellPx;
    const mapHeightPx = fogRows * cellPx;
    const baseRaster = state.raster ?? buildFogRaster(fogCols, fogRows, false, state.revealedCells);
    const finalRaster = compositeFogRaster(
      baseRaster,
      fogCols,
      fogRows,
      false,
      state.exemptCells,
      state.revealOpacity,
      state.scratchCanvas
    );

    ctx.save();
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(finalRaster, 0, 0, mapWidthPx, mapHeightPx);
    ctx.imageSmoothingEnabled = prevSmoothing;
    ctx.restore();
  }
}
