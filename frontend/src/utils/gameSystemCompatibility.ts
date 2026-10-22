// ============================================
// Which Characters may join which Campaigns
//
// A Campaign with no game system accepts any Character. A typed Campaign
// refuses a Flexible sheet and any Character of another system. Existing
// mismatches still load; the next mismatched write is 400.
//
// The server applies it when a Character is created into a Campaign, assigned
// to a Campaign, or brought along with an invitation; the browser uses it to
// decide which it offers.
//
// This file is byte-identical in backend/src/utils and frontend/src/utils; a
// backend test fails if the two copies drift.
// ============================================

/** Whether a Character of one game system may join a Campaign of another. */
export function systemsCompatible(characterSystem: string | null | undefined, campaignSystem: string | null | undefined): boolean {
  // A Campaign with no game system accepts any Character.
  if (!campaignSystem) return true;
  // A typed Campaign refuses a Flexible sheet and any other system.
  if (!characterSystem) return false;
  return characterSystem === campaignSystem;
}
