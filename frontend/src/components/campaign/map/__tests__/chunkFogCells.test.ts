/**
 * Fog operation chunking. The server refuses a reveal/hide over 20,000 cells
 * in one message; the canvas splits a larger rectangle so each emit stays
 * under that cap. Expected sizes are literals, not the production constant.
 */

import { describe, it, expect } from 'vitest';
import { chunkFogCells } from '../chunkFogCells';

describe('chunkFogCells', () => {
  it('keeps 20000 cells as one message', () => {
    const cells = Array.from({ length: 20000 }, (_, i) => i);
    const chunks = chunkFogCells(cells, 20000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(20000);
    expect(chunks[0][0]).toBe(0);
    expect(chunks[0][19999]).toBe(19999);
  });

  it('splits 20001 cells into a 20000 chunk and a remainder', () => {
    const cells = Array.from({ length: 20001 }, (_, i) => i);
    const chunks = chunkFogCells(cells, 20000);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(20000);
    expect(chunks[1]).toHaveLength(1);
    expect(chunks[1][0]).toBe(20000);
  });

  it('yields nothing for an empty list', () => {
    expect(chunkFogCells([], 20000)).toEqual([]);
  });
});
