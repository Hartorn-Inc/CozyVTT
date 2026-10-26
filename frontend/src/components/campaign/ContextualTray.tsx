// ============================================
// ContextualTray — labelled table actions under the map
//
// Visible buttons for the selected token (view / roll / edit / initiative),
// not a right-click-only path. HP uses visibleTokenHp so NPC hit points the
// viewer may not see never appear here. Narrow viewports also get Party /
// Session / Initiative drawer controls; wide viewports already have those
// surfaces as persistent rails.
// ============================================

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useToast } from '@/contexts/ToastContext';
import {
  useGameStore,
  useTokenInitiative,
  useTokenListIgnoringMovement,
} from '@/stores/gameStore';
import { canRollAsCharacter } from '@/services/permissions';
import { controlsToken } from '@/utils/tokenControl';
import { visibleTokenHp } from '@/components/campaign/map/tokenHitTest';
import { tokenDisplayName, tokenPublicName, characterRollPublicName } from '@/utils/tokenDisplayName';
import { apiErrorMessage } from '@/utils/errors';
import { GAME_SYSTEM_SHORT_LABELS } from '@/constants/game-systems';
import api from '@/services/api';
import Button from '@/components/ui/Button';
import CharacterSheetViewerModal from '@/components/character/CharacterSheetViewerModal';
import CharacterRollPicker from '@/components/campaign/CharacterRollPicker';
import NpcRollPicker from '@/components/campaign/NpcRollPicker';
import type { Character, Token } from '@/types';
import { TokenType } from '@/types';

const TOKEN_TYPE_LABELS: Record<TokenType, string> = {
  [TokenType.PLAYER]: 'Player',
  [TokenType.NPC]: 'NPC',
  [TokenType.OBJECT]: 'Object',
};

const NOTES_MAX = 120;

interface ContextualTrayProps {
  focusedTokenId: string | null;
  isWide: boolean;
  /** DM Player Preview: inspect as the projected table, not as the Keeper. */
  playerPreview?: boolean;
  onFocusToken: (tokenId: string | null) => void;
  onEditToken?: (token: Token) => void;
  onOpenParty: () => void;
  onOpenSession: () => void;
  onOpenInitiative: () => void;
  partyOpen: boolean;
  sessionOpen: boolean;
}

function tokenTypeLabel(token: Token): string {
  const type = token.type ?? (token.characterId ? TokenType.PLAYER : TokenType.NPC);
  return TOKEN_TYPE_LABELS[type] ?? type;
}

function truncateNotes(notes: string): string {
  const trimmed = notes.trim();
  if (trimmed.length <= NOTES_MAX) return trimmed;
  return `${trimmed.slice(0, NOTES_MAX - 1)}…`;
}

function formatHp(current: number, max: number, temp: number): string {
  const extra = temp > 0 ? ` (+${temp} temp)` : '';
  return `${current} / ${max}${extra}`;
}

export default function ContextualTray({
  focusedTokenId,
  isWide,
  playerPreview = false,
  onFocusToken,
  onEditToken,
  onOpenParty,
  onOpenSession,
  onOpenInitiative,
  partyOpen,
  sessionOpen,
}: ContextualTrayProps) {
  const { user } = useAuth();
  const { campaign, currentMap, userRole, characterHpCache } = useCampaign();
  const { socket } = useWebSocket();
  const { showToast } = useToast();
  const tokens = useTokenListIgnoringMovement();
  const initiative = useTokenInitiative(focusedTokenId);
  const token = focusedTokenId ? tokens.find((t) => t.id === focusedTokenId) : undefined;

  const [viewingSheet, setViewingSheet] = useState<{ character: Character; tokenId: string } | null>(null);
  const [rollPicker, setRollPicker] = useState<{
    characterId: string;
    tokenId: string;
    canRollInitiative: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [npcRollPicker, setNpcRollPicker] = useState<{ tokenId: string; x: number; y: number } | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);

  const isDM = userRole === 'DM';
  const inspectAsDm = isDM && !playerPreview;
  const membership = campaign?.memberships?.find((m) => m.userId === user?.id);
  const campaignHasCharacter = (characterId: string): boolean =>
    campaign?.characters?.some((c) => c.id === characterId) ?? false;

  const canRollForToken = (subject: Token): boolean => {
    if (!user || !subject.characterId) return false;
    const character = campaign?.characters?.find((c) => c.id === subject.characterId);
    if (!character) return false;
    return canRollAsCharacter(user, character, membership);
  };

  const canRollInitiativeFor = (subject: Token): boolean => {
    const combat = useGameStore.getState().combat;
    if (!combat.combatants.some((c) => c.tokenId === subject.id)) return false;
    if (inspectAsDm) return true;
    if (combat.active) return false;
    return controlsToken(subject, user?.id, userRole);
  };

  const identityHidden = Boolean(token && !inspectAsDm && (token.obscured || token.visible === false));
  const boundCharacter = token?.characterId && !identityHidden
    ? campaign?.characters?.find((c) => c.id === token.characterId)
    : undefined;
  const controllerName = token?.controlledBy && !identityHidden
    ? campaign?.memberships?.find((m) => m.userId === token.controlledBy)?.user?.displayName
    : undefined;
  const hp = token ? visibleTokenHp(token, characterHpCache, inspectAsDm) : null;
  const tokenKind = token ? (token.type ?? (token.characterId ? TokenType.PLAYER : TokenType.NPC)) : null;
  const showNpcRoll = Boolean(inspectAsDm && token && tokenKind === TokenType.NPC && !token.characterId);
  const showCharacterRoll = Boolean(token && !identityHidden && canRollForToken(token));
  const showViewSheet = Boolean(
    token?.characterId && !identityHidden && campaignHasCharacter(token.characterId)
  );
  const showEdit = Boolean(inspectAsDm && token);
  const showAddToInitiative = Boolean(inspectAsDm && token && currentMap);
  const focusedName = token
    ? (inspectAsDm ? tokenDisplayName(token) : tokenPublicName(token))
    : '';
  const selectableTokens = tokens.filter((t) => (inspectAsDm ? true : t.visible !== false));
  const optionName = (entry: Token) =>
    inspectAsDm ? tokenDisplayName(entry) : tokenPublicName(entry);

  const rollInitiativeForToken = (tokenId: string) => {
    if (!socket || !currentMap) return;
    const subject = tokens.find((t) => t.id === tokenId);
    socket.emitInitiativeRoll({
      tokenId,
      mapId: currentMap.id,
      characterName: subject ? tokenPublicName(subject) : undefined,
    });
  };

  const handleViewSheet = async () => {
    if (!token?.characterId) return;
    setSheetLoading(true);
    try {
      const { character } = await api.getCharacter(token.characterId);
      setViewingSheet({ character, tokenId: token.id });
    } catch (err) {
      showToast(apiErrorMessage(err) || 'Could not open that character sheet.', 'error');
    } finally {
      setSheetLoading(false);
    }
  };

  const handleRoll = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!token) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left;
    const y = rect.bottom;
    if (showCharacterRoll && token.characterId) {
      setRollPicker({
        characterId: token.characterId,
        tokenId: token.id,
        canRollInitiative: canRollInitiativeFor(token),
        x,
        y,
      });
      return;
    }
    if (showNpcRoll) {
      setNpcRollPicker({ tokenId: token.id, x, y });
    }
  };

  const handleAddToInitiative = () => {
    if (!token || !currentMap) return;
    socket?.emitInitiativeAdd({ tokenId: token.id, mapId: currentMap.id });
  };

  return (
    <section
      aria-label="Table actions"
      className="shrink-0 border-t border-brand/20 bg-surface px-3 py-2"
    >
      {selectableTokens.length > 0 && (
        <div className="mb-2">
          <label htmlFor="table-token-select" className="sr-only">
            Select a token
          </label>
          <select
            id="table-token-select"
            className="input-cozy min-h-11 max-w-full py-1.5 text-sm"
            value={focusedTokenId ?? ''}
            onChange={(event) => onFocusToken(event.target.value || null)}
          >
            <option value="">Select a token</option>
            {selectableTokens.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {optionName(entry)}
              </option>
            ))}
          </select>
        </div>
      )}

      {token ? (
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-ink truncate">{focusedName}</p>
            <p className="text-xs text-ink-muted">
              {tokenTypeLabel(token)}
              {controllerName ? ` · Controlled by ${controllerName}` : ''}
            </p>
            {(boundCharacter || (inspectAsDm && token.notes?.trim())) && (
              <p className="text-xs text-ink-muted">
                {boundCharacter && (
                  <span>
                    {boundCharacter.name}
                    {boundCharacter.gameSystem
                      ? ` · ${GAME_SYSTEM_SHORT_LABELS[boundCharacter.gameSystem]}`
                      : ''}
                  </span>
                )}
                {inspectAsDm && token.notes?.trim() && (
                  <span className={boundCharacter ? 'block' : undefined}>
                    {truncateNotes(token.notes)}
                  </span>
                )}
              </p>
            )}
            {hp && (
              <p className="text-xs text-ink">
                <span className="font-medium">HP</span> {formatHp(hp.current, hp.max, hp.temp)}
              </p>
            )}
            {token.conditions.length > 0 && (
              <ul className="flex flex-wrap gap-1" aria-label="Conditions">
                {token.conditions.map((condition) => (
                  <li key={condition} className="badge-neutral">
                    {condition}
                  </li>
                ))}
              </ul>
            )}
            {initiative !== undefined && (
              <p className="text-xs text-ink">
                <span className="font-medium">Initiative</span>{' '}
                {initiative === null ? '—' : initiative}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {showViewSheet && (
              <Button
                variant="secondary"
                className="min-h-11"
                loading={sheetLoading}
                onClick={() => {
                  void handleViewSheet();
                }}
              >
                View character sheet
              </Button>
            )}
            {(showCharacterRoll || showNpcRoll) && (
              <Button variant="secondary" className="min-h-11" onClick={handleRoll}>
                Roll…
              </Button>
            )}
            {showEdit && (
              <Button
                variant="secondary"
                className="min-h-11"
                onClick={() => onEditToken?.(token)}
              >
                Edit token
              </Button>
            )}
            {showAddToInitiative && (
              <Button variant="secondary" className="min-h-11" onClick={handleAddToInitiative}>
                Add to initiative
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          Select a token on the map. Actions for it are here — not only on right-click.
        </p>
      )}

      {!isWide && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            variant="ghost"
            className="min-h-11"
            aria-expanded={partyOpen}
            aria-controls="party-drawer"
            onClick={onOpenParty}
          >
            Party
          </Button>
          <Button
            variant="ghost"
            className="min-h-11"
            aria-expanded={sessionOpen}
            aria-controls="session-drawer"
            onClick={onOpenSession}
          >
            Session
          </Button>
          <Button
            variant="ghost"
            className="min-h-11"
            aria-expanded={sessionOpen}
            aria-controls="session-drawer"
            onClick={onOpenInitiative}
          >
            Initiative
          </Button>
        </div>
      )}

      {viewingSheet && campaign && (
        <CharacterSheetViewerModal
          character={viewingSheet.character}
          campaignId={campaign.id}
          membership={membership}
          campaign={campaign}
          publicName={characterRollPublicName(
            tokens.find((t) => t.id === viewingSheet.tokenId),
            user?.id
          )}
          onClose={() => setViewingSheet(null)}
        />
      )}

      {rollPicker && (
        <CharacterRollPicker
          characterId={rollPicker.characterId}
          onSpendHitDie={(index) =>
            socket?.emitHitDiceSpend({ characterId: rollPicker.characterId, index })
          }
          anchorX={rollPicker.x}
          anchorY={rollPicker.y}
          publicName={characterRollPublicName(
            tokens.find((t) => t.id === rollPicker.tokenId),
            user?.id
          )}
          onRoll={(expression, purpose, characterName) =>
            socket?.emitDiceRoll({ expression, purpose, characterName })
          }
          onRollInitiative={
            rollPicker.canRollInitiative
              ? () => rollInitiativeForToken(rollPicker.tokenId)
              : undefined
          }
          onClose={() => setRollPicker(null)}
        />
      )}

      {npcRollPicker && (() => {
        const npcToken = tokens.find((t) => t.id === npcRollPicker.tokenId);
        if (!npcToken) return null;
        return (
          <NpcRollPicker
            token={npcToken}
            gameSystem={campaign?.gameSystem ?? 'DND_5E'}
            anchorX={npcRollPicker.x}
            anchorY={npcRollPicker.y}
            onRoll={(expression, purpose, characterName) =>
              socket?.emitDiceRoll({ expression, purpose, characterName })
            }
            onClose={() => setNpcRollPicker(null)}
          />
        );
      })()}
    </section>
  );
}
