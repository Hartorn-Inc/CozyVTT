// ============================================
// Current map in campaign wiring is metadata.
//
// Live tokens belong in the Zustand store. GET map may still include tokens
// so join, current-map identity change, or catch-up can hydrate. After
// hydrate, currentMap.tokens is not live truth — store the document with
// an empty token list.
// ============================================

import type { Map } from '@/types';

/**
 * Persist identity, grid, image, walls/lights/fog, and flags. Drop GET
 * tokens so CampaignContext does not keep a second live list.
 */
export function asCurrentMapMetadata(map: Map): Map {
  return map.tokens?.length === 0 ? map : { ...map, tokens: [] };
}
