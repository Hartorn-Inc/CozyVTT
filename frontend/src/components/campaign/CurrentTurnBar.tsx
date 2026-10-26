// ============================================
// CurrentTurnBar — whose turn it is, above the map
//
// Combat inactive is an explicit empty state, not a fake turn. Names come
// from tokenDisplayName so an obscured token the viewer may not know is
// still called an unknown creature.
// ============================================

import { useCombatState, useTokenListIgnoringMovement } from '@/stores/gameStore';
import { tokenDisplayName, tokenPublicName } from '@/utils/tokenDisplayName';

interface CurrentTurnBarProps {
  /** Player Preview: name the turn the way the projected table may hear it. */
  playerPreview?: boolean;
}

export default function CurrentTurnBar({ playerPreview = false }: CurrentTurnBarProps) {
  const combat = useCombatState();
  const tokens = useTokenListIgnoringMovement();
  const nameOf = playerPreview ? tokenPublicName : tokenDisplayName;

  let message = 'Combat is not active';
  if (combat.active) {
    const token = combat.currentTokenId
      ? tokens.find((t) => t.id === combat.currentTokenId)
      : undefined;
    const combatant = combat.currentTokenId
      ? combat.combatants.find((c) => c.tokenId === combat.currentTokenId)
      : undefined;
    if (token) {
      message = `${nameOf(token)}'s turn`;
    } else if (combatant) {
      message = `${nameOf(combatant)}'s turn`;
    } else {
      message = 'Current turn';
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Current turn"
      className="shrink-0 border-b border-brand/20 bg-surface px-3 py-2 text-sm text-ink"
    >
      {message}
    </div>
  );
}
