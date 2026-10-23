/**
 * Re-apply queued fog ops on top of a `fog:updated` snapshot so a chunk
 * echo cannot snap an optimistic rectangle back.
 */

import { describe, it, expect } from 'vitest';
import type { FogState } from '@/types/walls';
import { fogRevealedEquals, overlayFogOperations } from '../overlayFogOperations';
import type { FogQueuedOperation } from '../fogOperationQueue';

function fog(revealed: boolean[]): FogState {
  return { fogCols: revealed.length, fogRows: 1, cellPx: 32, revealed };
}

function reveal(cells: number[]): FogQueuedOperation {
  return { mapId: 'map-1', op: 'reveal', cells };
}

describe('overlayFogOperations', () => {
  it('keeps a two-chunk reveal fully revealed when the first echo has only the first 20000 cells true', () => {
    const snapshot = fog([
      ...Array.from({ length: 20000 }, () => true),
      false,
    ]);
    const firstChunk = Array.from({ length: 20000 }, (_, i) => i);
    const next = overlayFogOperations(snapshot, [
      reveal(firstChunk),
      reveal([20000]),
    ]);
    expect(next.revealed).toHaveLength(20001);
    expect(next.revealed[0]).toBe(true);
    expect(next.revealed[19999]).toBe(true);
    expect(next.revealed[20000]).toBe(true);
    expect(snapshot.revealed[20000]).toBe(false);
  });

  it('does not wipe a second rectangle still in pending when the first chunk echo arrives', () => {
    const snapshot = fog([true, true, true, false, false, false, false, false]);
    const next = overlayFogOperations(snapshot, [
      reveal([0, 1, 2]),
      reveal([5, 6]),
    ]);
    expect(next.revealed).toEqual([true, true, true, false, false, true, true, false]);
  });

  it('lets reveal_all in the list win over earlier cell ops', () => {
    const snapshot = fog([false, false, true]);
    const next = overlayFogOperations(snapshot, [
      { mapId: 'map-1', op: 'hide', cells: [2] },
      { mapId: 'map-1', op: 'reveal_all' },
    ]);
    expect(next.revealed).toEqual([true, true, true]);
  });

  it('lets hide_all in the list win over earlier cell ops', () => {
    const snapshot = fog([true, true, true]);
    const next = overlayFogOperations(snapshot, [
      reveal([0, 1]),
      { mapId: 'map-1', op: 'hide_all' },
    ]);
    expect(next.revealed).toEqual([false, false, false]);
  });

  it('applies a later hide on top of reveal_all so a secret stays hidden during the wait', () => {
    const snapshot = fog([false, false, true]);
    const next = overlayFogOperations(snapshot, [
      { mapId: 'map-1', op: 'reveal_all' },
      { mapId: 'map-1', op: 'hide', cells: [1] },
    ]);
    expect(next.revealed).toEqual([true, false, true]);
  });

  it('returns the same snapshot when there is nothing to overlay', () => {
    const snapshot = fog([true, false]);
    expect(overlayFogOperations(snapshot, [])).toBe(snapshot);
  });
});

describe('fogRevealedEquals', () => {
  it('is true for the same revealed cells and false when a cell differs', () => {
    expect(fogRevealedEquals(fog([true, false, true]), fog([true, false, true]))).toBe(true);
    expect(fogRevealedEquals(fog([true, false, true]), fog([true, true, true]))).toBe(false);
    expect(fogRevealedEquals(fog([true, true]), fog([true, true, true]))).toBe(false);
  });
});
