/**
 * The table-actions tray is the visible path for selected-token actions.
 * Players can View and Roll without a right-click context menu.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Token } from '@/types';
import { TokenLayer, TokenType } from '@/types';
import { useGameStore } from '@/stores/gameStore';

const { showToast, emitInitiativeAdd, emitDiceRoll, getCharacter } = vi.hoisted(() => ({
  showToast: vi.fn(),
  emitInitiativeAdd: vi.fn(),
  emitDiceRoll: vi.fn(),
  getCharacter: vi.fn(),
}));

const campaignState = vi.hoisted(() => ({
  userRole: 'DM' as 'DM' | 'PLAYER' | 'SPECTATOR',
  userId: 'dm',
  characterHpCache: {} as Record<string, { current: number; max: number; temp: number }>,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: campaignState.userId, displayName: 'Tester' } }),
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({
    campaign: {
      id: 'campaign-1',
      name: 'Test',
      gameSystem: 'DND_5E',
      memberships: [
        { userId: 'dm', role: 'DM', user: { displayName: 'Keeper' } },
        {
          userId: 'player',
          role: campaignState.userId === 'player' ? campaignState.userRole : 'PLAYER',
          user: { displayName: 'Ada' },
        },
      ],
      characters: [
        { id: 'char-1', userId: 'player', name: 'Aldra', gameSystem: 'DND_5E' },
      ],
    },
    currentMap: { id: 'map-1', name: 'Map' },
    userRole: campaignState.userRole,
    characterHpCache: campaignState.characterHpCache,
  }),
}));
vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocket: () => ({
    socket: { emitInitiativeAdd, emitDiceRoll, emitHitDiceSpend: vi.fn(), emitInitiativeRoll: vi.fn() },
  }),
}));
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
}));
vi.mock('@/services/api', () => ({
  default: { getCharacter },
  api: { getCharacter },
}));
vi.mock('@/components/character/CharacterSheetViewerModal', () => ({
  default: ({ character, onClose }: { character: { name: string }; onClose: () => void }) => (
    <div role="dialog" aria-label={`Sheet ${character.name}`}>
      <button type="button" onClick={onClose}>Close sheet</button>
    </div>
  ),
}));
vi.mock('@/components/campaign/CharacterRollPicker', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Roll picker">
      <button type="button" onClick={onClose}>Close rolls</button>
    </div>
  ),
}));
vi.mock('@/components/campaign/NpcRollPicker', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="NPC roll picker">
      <button type="button" onClick={onClose}>Close NPC rolls</button>
    </div>
  ),
}));

import ContextualTray from '../ContextualTray';

function makeToken(overrides: Partial<Token> = {}): Token {
  return {
    id: 'tok-1',
    name: 'Aldra',
    characterId: 'char-1',
    imageUrl: '',
    position: { x: 0, y: 0 },
    size: { width: 1, height: 1 },
    layer: TokenLayer.TOKEN,
    visible: true,
    controlledBy: 'player',
    rotation: 0,
    conditions: ['poisoned'],
    metadata: {},
    type: TokenType.PLAYER,
    disposition: null,
    hp: { current: 8, max: 12, temp: 0 },
    showHpBar: true,
    notes: 'A note the DM can read',
    initiative: null,
    obscured: false,
    ...overrides,
  };
}

const trayProps = {
  isWide: true,
  onFocusToken: vi.fn(),
  onEditToken: vi.fn(),
  onOpenParty: vi.fn(),
  onOpenSession: vi.fn(),
  onOpenInitiative: vi.fn(),
  partyOpen: false,
  sessionOpen: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  campaignState.userRole = 'DM';
  campaignState.userId = 'dm';
  campaignState.characterHpCache = { 'char-1': { current: 10, max: 20, temp: 2 } };
  useGameStore.getState().clearGameState();
  useGameStore.getState().setTokens([makeToken()]);
  getCharacter.mockResolvedValue({
    character: { id: 'char-1', userId: 'player', name: 'Aldra', data: {}, gameSystem: 'DND_5E' },
  });
});

describe('ContextualTray', () => {
  it('asks the user to select a token when nothing is focused', () => {
    render(<ContextualTray {...trayProps} focusedTokenId={null} />);
    expect(screen.getByRole('region', { name: 'Table actions' })).toHaveTextContent(
      'Select a token on the map'
    );
    expect(screen.getByText(/not only on right-click/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Select a token')).toBeInTheDocument();
  });

  it('lets the viewer pick a token from the labelled select', () => {
    render(<ContextualTray {...trayProps} focusedTokenId={null} />);
    fireEvent.change(screen.getByLabelText('Select a token'), { target: { value: 'tok-1' } });
    expect(trayProps.onFocusToken).toHaveBeenCalledWith('tok-1');
  });

  it('lists visible tokens in the select, including ones a player does not control', () => {
    campaignState.userRole = 'PLAYER';
    campaignState.userId = 'player';
    useGameStore.getState().setTokens([
      makeToken(),
      makeToken({
        id: 'npc-1',
        name: 'Goblin',
        characterId: null,
        type: TokenType.NPC,
        controlledBy: null,
        conditions: [],
      }),
      makeToken({
        id: 'hid-1',
        name: 'Hidden Scout',
        characterId: null,
        type: TokenType.NPC,
        controlledBy: null,
        visible: false,
        conditions: [],
      }),
    ]);

    render(<ContextualTray {...trayProps} focusedTokenId={null} />);
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toContain('Aldra');
    expect(options).toContain('Goblin');
    expect(options).not.toContain('Hidden Scout');
  });

  it('does not name an obscured token or its bound character to a player', () => {
    campaignState.userRole = 'PLAYER';
    campaignState.userId = 'player';
    useGameStore.getState().setTokens([
      makeToken({
        id: 'tok-disguise',
        name: '',
        obscured: true,
        conditions: [],
      }),
    ]);

    render(<ContextualTray {...trayProps} focusedTokenId="tok-disguise" />);
    const tray = screen.getByRole('region', { name: 'Table actions' });
    expect(tray).toHaveTextContent('Unknown creature');
    expect(tray).not.toHaveTextContent('Aldra');
    expect(screen.queryByRole('button', { name: 'View character sheet' })).toBeNull();
  });

  it('inspects as a player during DM Player Preview', () => {
    useGameStore.getState().setTokens([
      makeToken({
        id: 'npc-1',
        name: 'Goblin',
        characterId: null,
        type: TokenType.NPC,
        controlledBy: null,
        conditions: ['poisoned'],
        hp: { current: 4, max: 7, temp: 0 },
        showHpBar: false,
        notes: 'Keeper only',
      }),
    ]);

    render(<ContextualTray {...trayProps} playerPreview focusedTokenId="npc-1" />);
    const tray = screen.getByRole('region', { name: 'Table actions' });
    expect(tray).toHaveTextContent('Goblin');
    expect(tray).not.toHaveTextContent('Keeper only');
    expect(screen.queryByText(/HP/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit token' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to initiative' })).toBeNull();
  });

  it('shows the focused token name, HP, and conditions from the live token list', () => {
    render(<ContextualTray {...trayProps} focusedTokenId="tok-1" />);
    const tray = screen.getByRole('region', { name: 'Table actions' });
    expect(tray).toHaveTextContent('Aldra');
    expect(tray).toHaveTextContent('HP');
    expect(tray).toHaveTextContent('10 / 20');
    expect(tray).toHaveTextContent('+2 temp');
    expect(screen.getByRole('list', { name: 'Conditions' })).toHaveTextContent('poisoned');
  });

  it('hides NPC hit points a player is not allowed to see', () => {
    campaignState.userRole = 'PLAYER';
    campaignState.userId = 'player';
    campaignState.characterHpCache = {};
    useGameStore.getState().setTokens([
      makeToken({
        id: 'npc-1',
        name: 'Goblin',
        characterId: null,
        type: TokenType.NPC,
        controlledBy: null,
        conditions: [],
        hp: { current: 4, max: 7, temp: 0 },
        showHpBar: false,
      }),
    ]);

    render(<ContextualTray {...trayProps} focusedTokenId="npc-1" />);
    expect(screen.getByRole('region', { name: 'Table actions' })).toHaveTextContent('Goblin');
    expect(screen.queryByText(/HP/)).toBeNull();
  });

  it('lets a player view and roll without a context menu', async () => {
    campaignState.userRole = 'PLAYER';
    campaignState.userId = 'player';

    render(<ContextualTray {...trayProps} focusedTokenId="tok-1" />);

    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View character sheet' }));
    expect(await screen.findByRole('dialog', { name: 'Sheet Aldra' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close sheet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll…' }));
    expect(screen.getByRole('dialog', { name: 'Roll picker' })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Edit token' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to initiative' })).toBeNull();
  });

  it('offers edit and add-to-initiative to the DM', () => {
    render(<ContextualTray {...trayProps} focusedTokenId="tok-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit token' }));
    expect(trayProps.onEditToken).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add to initiative' }));
    expect(emitInitiativeAdd).toHaveBeenCalledWith({ tokenId: 'tok-1', mapId: 'map-1' });
  });

  it('omits roll and edit for a spectator', () => {
    campaignState.userRole = 'SPECTATOR';
    campaignState.userId = 'player';
    render(<ContextualTray {...trayProps} focusedTokenId="tok-1" />);
    expect(screen.getByRole('button', { name: 'View character sheet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Roll…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit token' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to initiative' })).toBeNull();
  });

  it('shows Party, Session and Initiative controls only on a narrow viewport', () => {
    const { rerender } = render(
      <ContextualTray {...trayProps} isWide={false} focusedTokenId={null} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Party' }));
    expect(trayProps.onOpenParty).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Initiative' }));
    expect(trayProps.onOpenInitiative).toHaveBeenCalled();

    rerender(<ContextualTray {...trayProps} isWide focusedTokenId={null} />);
    expect(screen.queryByRole('button', { name: 'Party' })).toBeNull();
  });

  it('omits initiative when the token is not a combatant, and shows a dash when it has not rolled', () => {
    const { rerender } = render(<ContextualTray {...trayProps} focusedTokenId="tok-1" />);
    expect(screen.queryByText('Initiative')).toBeNull();

    useGameStore.getState().setCombatState({
      active: false,
      round: 0,
      currentTokenId: null,
      combatants: [
        {
          tokenId: 'tok-1',
          mapId: 'map-1',
          name: 'Aldra',
          imageUrl: '',
          initiative: null,
          hp: null,
          type: 'player',
          disposition: null,
        },
      ],
    });
    rerender(<ContextualTray {...trayProps} focusedTokenId="tok-1" />);
    expect(screen.getByRole('region', { name: 'Table actions' })).toHaveTextContent('Initiative');
    expect(screen.getByRole('region', { name: 'Table actions' })).toHaveTextContent('—');
  });

  it('toasts when the character sheet fails to load', async () => {
    getCharacter.mockRejectedValue({ response: { data: { message: 'Not found' } } });
    render(<ContextualTray {...trayProps} focusedTokenId="tok-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'View character sheet' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Not found', 'error'));
  });
});
