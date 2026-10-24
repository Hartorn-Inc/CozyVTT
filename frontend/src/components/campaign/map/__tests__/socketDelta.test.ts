/**
 * A socket delta for another map or an older join is discarded. The live
 * table used to apply every `token.moved` it heard, so a frame from a map
 * the client had left, or from before a rejoin, teleported tokens on the
 * map showing. Missing map id is treated as another map: the server always
 * sends one.
 */

import { describe, it, expect } from 'vitest';
import { shouldApplySocketDelta } from '../socketDelta';

const matching = {
  eventMapId: 'map-a',
  currentMapId: 'map-a',
  boundJoinEpoch: 2,
  currentJoinEpoch: 2,
};

describe('shouldApplySocketDelta', () => {
  it('applies a delta for this map on this join', () => {
    expect(shouldApplySocketDelta(matching)).toBe(true);
  });

  it('discards a delta for another map', () => {
    expect(shouldApplySocketDelta({ ...matching, eventMapId: 'map-b' })).toBe(false);
  });

  it('discards a delta from an older join', () => {
    expect(shouldApplySocketDelta({ ...matching, boundJoinEpoch: 1 })).toBe(false);
  });

  it('discards a delta before the connection has joined', () => {
    expect(shouldApplySocketDelta({ ...matching, currentJoinEpoch: 0, boundJoinEpoch: 0 })).toBe(false);
  });

  it('discards a delta with no map id', () => {
    expect(shouldApplySocketDelta({ ...matching, eventMapId: undefined })).toBe(false);
    expect(shouldApplySocketDelta({ ...matching, eventMapId: '' })).toBe(false);
  });

  it('discards a delta when this client has no current map', () => {
    expect(shouldApplySocketDelta({ ...matching, currentMapId: undefined })).toBe(false);
  });
});
