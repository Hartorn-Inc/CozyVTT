// ============================================
// Fog operation cell chunking
//
// A reveal/hide names at most 20,000 cells per `fog:operation` (the server
// refuses a larger array). A rectangle drag can cover more; these helpers
// split the cell list so each message stays under the cap. Pure: no React.
// ============================================

/** Most cells one `fog:operation` reveal/hide may name. Same cap as the server. */
export const FOG_MESSAGE_MAX_CELLS = 20000;

/**
 * Minimum gap between `fog:operation` emits. The sliding window (limit / ms /
 * margin below) is the authority for staying inside the server's 10/1000ms
 * silent drop; this gap is only a floor so adjacent chunks are not burst.
 */
export const FOG_OPERATION_CHUNK_GAP_MS = 100;

/**
 * Window limit reserving headroom under the shared 10 ops / 1000ms per-user
 * ceiling so a second tab cannot easily exhaust the budget and drop chunks.
 */
export const FOG_OPERATION_WINDOW_LIMIT = 5;

/** Server window: timestamps with `now - timestamp < 1000` still count. */
export const FOG_OPERATION_WINDOW_MS = 1000;

/**
 * Extra wait so the oldest emit in the window is at least this far past the
 * server window before the next is sent. Clock jitter on this tab would
 * otherwise land a tail chunk on the silent drop; a dropped hide fails open.
 * Note: this per-page 50ms margin only paces the local queue and does not
 * coordinate across separate DM tabs sharing the per-user limiter key.
 */
export const FOG_OPERATION_WINDOW_MARGIN_MS = 50;

/**
 * Split `cells` into contiguous slices of at most `maxCells` indices each.
 * An empty list yields no chunks. Order is preserved.
 */
export function chunkFogCells(cells: readonly number[], maxCells: number): number[][] {
  if (cells.length === 0 || maxCells <= 0) return [];
  const chunks: number[][] = [];
  for (let i = 0; i < cells.length; i += maxCells) {
    chunks.push(cells.slice(i, i + maxCells));
  }
  return chunks;
}
