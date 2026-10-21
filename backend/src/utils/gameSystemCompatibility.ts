// ============================================
// Which characters may join which campaigns
//
// A typed Campaign (one with a game system) accepts only a Character of that
// same system. A Flexible Character (no system) is refused by a typed
// Campaign. A Campaign with no game system accepts any Character. The server
// applies this on create-in, assign, and invitation accept; the browser uses
// it to decide which it offers. Existing mismatches still load.
//
// This file is byte-identical in backend/src/utils and frontend/src/utils; a
// backend test fails if the two copies drift.
// ============================================

/** Whether a character of one game system may join a campaign of another. */
export function systemsCompatible(characterSystem: string | null | undefined, campaignSystem: string | null | undefined): boolean {
  if (!campaignSystem) return true;
  return characterSystem === campaignSystem;
}
