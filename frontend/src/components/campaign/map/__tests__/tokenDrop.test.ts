/**
 * A token drop that cannot be sent must not keep the new cell. The canvas
 * used to call applyTokenMove after a failed emit, so the mover saw a square
 * the table had not accepted.
 */

import { describe, it, expect, vi } from 'vitest';
import { applyLocalTokenDrop } from '../tokenDrop';

describe('applyLocalTokenDrop', () => {
  it('commits the drop when the write can be sent', () => {
    const apply = vi.fn();
    const revert = vi.fn();

    expect(applyLocalTokenDrop({ canSend: true, apply, revert })).toBe('commit');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(revert).not.toHaveBeenCalled();
  });

  it('does not apply the drop when the socket cannot send, and reverts the hold', () => {
    const apply = vi.fn();
    const revert = vi.fn();

    expect(applyLocalTokenDrop({ canSend: false, apply, revert })).toBe('revert');
    expect(apply).not.toHaveBeenCalled();
    expect(revert).toHaveBeenCalledTimes(1);
  });
});
