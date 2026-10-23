// ============================================
// Local token drop: commit only when the write can be sent.
//
// Putting a token down used to update the store even when the socket could
// not emit `token.move.end`, so the mover saw a new square nobody else had.
// A drop that cannot be sent leaves the token on its last confirmed square
// and tells the caller to say so.
// ============================================

export type TokenDropApplyResult = 'commit' | 'revert';

/**
 * Apply a local token drop, or put the token back.
 *
 * `apply` writes the new square (and is what emits). `revert` cancels the
 * hold so the token stays where it last stood. The caller toasts on `'revert'`.
 */
export function applyLocalTokenDrop(options: {
  canSend: boolean;
  apply: () => void;
  revert: () => void;
}): TokenDropApplyResult {
  if (!options.canSend) {
    options.revert();
    return 'revert';
  }
  options.apply();
  return 'commit';
}
