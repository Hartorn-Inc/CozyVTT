/**
 * The current-turn region names the acting token, or says combat is not active.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CurrentTurnBar from '../CurrentTurnBar';
import { useGameStore } from '@/stores/gameStore';
import type { Token } from '@/types';
import { TokenLayer, TokenType } from '@/types';

function token(id: string, name: string, obscured = false): Token {
  return {
    id,
    name,
    characterId: null,
    imageUrl: '',
    position: { x: 0, y: 0 },
    size: { width: 1, height: 1 },
    layer: TokenLayer.TOKEN,
    visible: true,
    controlledBy: null,
    rotation: 0,
    conditions: [],
    metadata: {},
    type: TokenType.NPC,
    disposition: null,
    hp: null,
    showHpBar: false,
    notes: '',
    initiative: null,
    obscured,
  };
}

beforeEach(() => {
  useGameStore.getState().clearGameState();
});

describe('CurrentTurnBar', () => {
  it('says combat is not active when the fight has not started', () => {
    render(<CurrentTurnBar />);
    expect(screen.getByRole('status', { name: 'Current turn' })).toHaveTextContent(
      'Combat is not active'
    );
  });

  it("names the acting token once combat is active", () => {
    useGameStore.getState().setTokens([token('hero', 'Aldra')]);
    useGameStore.getState().setCombatState({
      active: true,
      round: 1,
      currentTokenId: 'hero',
      combatants: [
        {
          tokenId: 'hero',
          mapId: 'map-1',
          name: 'Aldra',
          imageUrl: '',
          initiative: 15,
          hp: null,
          type: 'npc',
          disposition: null,
        },
      ],
    });

    render(<CurrentTurnBar />);
    expect(screen.getByRole('status', { name: 'Current turn' })).toHaveTextContent("Aldra's turn");
  });

  it('uses the public name during Player Preview so an obscured creature is not named', () => {
    useGameStore.getState().setTokens([token('hero', 'Aldra', true)]);
    useGameStore.getState().setCombatState({
      active: true,
      round: 1,
      currentTokenId: 'hero',
      combatants: [
        {
          tokenId: 'hero',
          mapId: 'map-1',
          name: 'Aldra',
          imageUrl: '',
          initiative: 15,
          hp: null,
          type: 'npc',
          disposition: null,
        },
      ],
    });

    render(<CurrentTurnBar playerPreview />);
    expect(screen.getByRole('status', { name: 'Current turn' })).toHaveTextContent(
      "Unknown creature's turn"
    );
  });
});
