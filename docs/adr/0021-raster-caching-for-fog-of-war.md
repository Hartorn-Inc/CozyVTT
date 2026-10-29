---
status: accepted
---
# Offscreen raster caching for manual fog of war rendering

## Context

In CozyVTT, map rendering on `MapCanvas.tsx` is divided across multiple canvas layers. The manual Fog of War layer (`frontend/src/components/campaign/map/layers/drawFog.ts`) renders manual fog: opaque deep-purple fog for players (`rgba(15, 12, 25, 1)`) and translucent fog for the DM (`rgba(15, 12, 25, 0.55)`).

Prior to this decision, `drawFog.ts` iterated cell-by-cell across the entire map grid (`fogRows × fogCols`) on every single animation frame where the overlay repaints. On a 100×100 grid, this executed 10,000 loop iterations and thousands of individual `ctx.fillRect()` canvas API calls at 60 fps whenever the cursor moved, measurements were adjusted, or tokens were dragged. This created severe CPU and GPU bottlenecks on medium-to-large maps.

While dynamic lighting explored memory maintains an offscreen raster cache (`exploredRaster`), manual Fog lacked an equivalent mechanism and incurred the full redraw cost on every frame.

## Decision

1. **Maintain a 1px/cell Offscreen Raster Cache for Manual Fog**:
   - Introduce an offscreen canvas (`HTMLCanvasElement`) sized exactly at `fogCols × fogRows` pixels (1 pixel per grid cell).
   - Unrevealed cells are written to the raster with the target fog color (`rgba(15, 12, 25, 1)` for players, `rgba(15, 12, 25, 0.55)` for DM).
   - Revealed cells have alpha `0` (transparent).
   - The static raster is recomputed strictly when the underlying fog revealed state (`revealedCells` for players, `fogState.revealed` for DM) or grid dimensions change.

2. **Decouple Static Fog State from Dynamic Frame Elements**:
   - **Exempt Cells (`exemptCells`)**: Cells occupied by a player's own tokens must remain clear regardless of fog state. Because token movements occur frequently, exempt cells are excluded at render time (via a lightweight scratch compositing canvas or targeted clearing) without invalidating the static offscreen raster.
   - **Reveal Opacity (`revealOpacity`)**: Per-cell animated fade transitions (fading from 1 to 0 over ~300ms) are composited on top during the render pass, preserving 60 fps fluidity without repeatedly rebuilding the static raster buffer.

3. **Single `drawImage` Blit with Nearest-Neighbor Smoothing Disabled**:
   - The offscreen raster is rendered onto the main viewport canvas via a single `ctx.drawImage(raster, 0, 0, mapWidthPx, mapHeightPx)` operation.
   - `ctx.imageSmoothingEnabled = false` is enforced before the blit and restored immediately afterward. This guarantees crisp, pixel-perfect grid cell boundaries across all zoom levels without GPU bilinear filtering blur.

4. **Isolated Pure Module (`fogRaster.ts`) with TDD Coverage**:
   - Extract buffer allocation, pixel manipulation via `ImageData`, and cache invalidation logic into `frontend/src/components/campaign/map/fogRaster.ts`.
   - Keep the module completely pure and decoupled from React hooks, enabling rigorous unit testing under Vitest and JSDOM.
   - Update `drawFog.ts` and `drawFog.test.ts` to assert that map-wide rendering issues a single `drawImage` call instead of O(N) `fillRect` calls.

## Consequences

- **Positive**:
  - Per-frame fog rendering cost drops from O(fogRows × fogCols) `fillRect` calls to a single O(1) `drawImage` blit.
  - Pointer moves, measurement rulers, and token dragging maintain steady 60 fps performance even on 100×100 (10,000 cells) or larger maps.
  - Preserves exact visual fidelity and zoom aesthetics across player and DM views.
  - Maintains a clean domain boundary between manual Fog (`drawFog.ts`) and dynamic lighting explored memory (`drawDynamicLighting.ts`), adhering strictly to `GLOSSARY.md`.

- **Negative / Operational Trade-offs**:
  - Introduces minimal memory overhead for the offscreen canvas (100×100 pixels = 40 KB `ImageData` buffer per map).
  - Compositing dynamic exemptions and cell fade animations requires dynamic handling during the render pass.

## Considered Options

- **Iterate all grid cells on every frame (Status Quo)**: Rejected due to prohibitive CPU overhead (10,000 `fillRect` calls per frame) on medium and large maps.
- **Full-resolution offscreen canvas (e.g. 5000×5000 pixels)**: Rejected due to unacceptable memory consumption (100 MB+ GPU texture memory) compared to the 40 KB footprint of a 1px/cell raster.
- **Merge Manual Fog with Dynamic Lighting Explored Memory**: Rejected because manual Fog and Explored Memory serve distinct game mechanics and belong to independent layers in `GLOSSARY.md`.
