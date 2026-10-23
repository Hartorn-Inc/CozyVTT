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
 * Minimum gap between chunked `fog:operation` emits. The server silently drops
 * fog ops past 10 a second; 100 ms keeps adjacent chunks inside that ceiling.
 */
export const FOG_OPERATION_CHUNK_GAP_MS = 100;

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
