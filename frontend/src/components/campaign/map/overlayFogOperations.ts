// ============================================
// Overlay local fog ops onto a server snapshot
//
// `fog:updated` is the whole grid. Chunked reveal/hide echoes therefore
// replace an optimistic rectangle with only the cells that chunk named.
// Re-apply queued work (in-flight already-emitted ops, then pending unsent
// ops) in order so a later stroke or the rest of a split rectangle is not
// wiped. reveal_all / hide_all fill the grid; a later cell op after them
// is the DM's newest stroke and must still apply.
// Pure: no socket, no React.
// ============================================

import type { FogState } from '@/types/walls';
import type { FogQueuedOperation } from './fogOperationQueue';

/**
 * Copy of `fog` with `ops` applied in order. Does not mutate `fog`.
 * An empty `ops` returns `fog` itself.
 */
export function overlayFogOperations(
  fog: FogState,
  ops: readonly FogQueuedOperation[],
): FogState {
  if (ops.length === 0) return fog;
  const revealed = fog.revealed.slice();
  const total = revealed.length;
  for (const op of ops) {
    switch (op.op) {
      case 'reveal_all':
        revealed.fill(true);
        break;
      case 'hide_all':
        revealed.fill(false);
        break;
      case 'reveal':
        for (const idx of op.cells) {
          if (idx >= 0 && idx < total) revealed[idx] = true;
        }
        break;
      case 'hide':
        for (const idx of op.cells) {
          if (idx >= 0 && idx < total) revealed[idx] = false;
        }
        break;
    }
  }
  return { ...fog, revealed };
}

/** True when both grids name the same cells as revealed. Used to know the server has caught up. */
export function fogRevealedEquals(a: FogState, b: FogState): boolean {
  const left = a.revealed;
  const right = b.revealed;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}
