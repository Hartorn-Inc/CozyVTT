/**
 * Current map metadata drops GET tokens after they hydrate the store.
 * Identity, grid, image, walls, lights, and fog stay.
 */

import { describe, it, expect } from 'vitest';
import type { Map } from '@/types';
import { asCurrentMapMetadata } from '../currentMapMetadata';

const mapWithTokens = {
  id: 'm1',
  name: 'Keep',
  imageUrl: '/maps/keep.png',
  gridSize: 50,
  tokens: [{ id: 't1', position: { x: 4, y: 8 } }],
  wallSegments: [{ id: 'w1', x1: 0, y1: 0, x2: 10, y2: 0, type: 'wall' }],
  lights: [{ id: 'l1', x: 1, y: 1, brightRadius: 2, dimRadius: 4, color: '#ffcc66', enabled: true }],
  fogEnabled: true,
  globalIllumination: false,
} as unknown as Map;

describe('asCurrentMapMetadata', () => {
  it('keeps current-map metadata and drops tokens', () => {
    const metadata = asCurrentMapMetadata(mapWithTokens);
    expect(metadata).toMatchObject({
      id: 'm1',
      name: 'Keep',
      imageUrl: '/maps/keep.png',
      gridSize: 50,
      wallSegments: mapWithTokens.wallSegments,
      lights: mapWithTokens.lights,
      fogEnabled: true,
      globalIllumination: false,
    });
    expect(metadata.tokens).toEqual([]);
    expect(mapWithTokens.tokens).toHaveLength(1);
  });

  it('returns the same map when tokens are already empty', () => {
    const empty = { ...mapWithTokens, tokens: [] };
    expect(asCurrentMapMetadata(empty)).toBe(empty);
  });
});
