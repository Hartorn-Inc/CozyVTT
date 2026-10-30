/**
 * Tests for MapCanvas Spirit Layer toolbar tooltip and context menu error toasts.
 *
 * Verifies:
 * 1. The DM Spirit Layer toolbar button title dynamically indicates 'Spirit tokens shown, click to hide'
 *    when dmShowSpiritTokens is true, and 'Hiding spirit tokens (click to show)' when false.
 * 2. Right-click context menu actions (Hide/Reveal, Obscure/Reveal identity, Send to Spirit Realm/Return
 *    to Material Plane) display error toast notifications with apiErrorMessage(err) or 'Failed to update token'.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TokenType, TokenLayer, type Map as CampaignMap, type Token } from '@/types';

const h = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let version = 0;
  const state = {
    userRole: 'DM' as string,
    currentMap: null as unknown,
  };
  const showToast = vi.fn();
  const updateToken = vi.fn();
  const raw = {
    connected: true,
    on() { return raw; },
    off() { return raw; },
    emit() { return raw; },
  };
  return {
    state,
    showToast,
    updateToken,
    raw,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    snapshot: () => version,
    set(patch: Partial<typeof state>) {
      Object.assign(state, patch);
      version += 1;
      listeners.forEach((l) => l());
    },
  };
});

vi.mock('@/contexts/CampaignContext', async () => {
  const { useSyncExternalStore } = await import('react');
  const noop = () => undefined;
  const campaign = { id: 'campaign-1', name: 'Test', spiritLayerEnabled: false, memberships: [], characters: [] };
  return {
    useCampaign: () => {
      useSyncExternalStore(h.subscribe, h.snapshot);
      return {
        currentMap: h.state.currentMap,
        setCurrentMap: noop,
        userRole: h.state.userRole,
        campaign,
        updateCampaignSpiritLayer: noop,
        dmViewBothPlanes: false,
        playerSpiritVisible: false,
        setPlayerSpiritVisible: noop,
        activeVibeEffect: null,
        updateVibe: noop,
        activeAtmosphereEffect: null,
        characterHpCache: {},
      };
    },
  };
});

vi.mock('@/contexts/WebSocketContext', async () => {
  const { useSyncExternalStore } = await import('react');
  const client = new Proxy({
    getSocket: () => h.raw,
    emitMapChange: vi.fn(),
  } as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return () => () => undefined;
    },
  });
  return {
    useWebSocket: () => {
      useSyncExternalStore(h.subscribe, h.snapshot);
      return {
        socket: client,
        joinedEpoch: 1,
        status: 'connected',
        reconnectCount: 0,
      };
    },
  };
});

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: h.showToast }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'dm-user', displayName: 'The DM' } }),
}));

vi.mock('@/services/map.service', () => ({
  default: { updateMap: vi.fn(), getMaps: vi.fn().mockResolvedValue([]), getMap: vi.fn() },
}));

vi.mock('@/services/api', () => {
  const client = new Proxy({}, {
    get: (_target, prop: string) =>
      prop === 'updateToken' ? h.updateToken : vi.fn().mockResolvedValue({}),
  });
  return { api: client, default: client };
});

import MapCanvas from '../MapCanvas';
import { useGameStore } from '@/stores/gameStore';

const testMap: CampaignMap = {
  id: 'map-1',
  campaignId: 'campaign-1',
  name: 'Test Map',
  imageUrl: '/api/assets/maps/test',
  baseLayerUrl: '/api/assets/maps/test',
  spiritLayerUrl: null,
  width: 20,
  height: 20,
  gridSize: 50,
  feetPerSquare: 5,
  diagonalRule: 'flat',
  tokens: [],
  annotations: [],
  wallSegments: [],
  lights: [],
  fogEnabled: false,
  lightingEnabled: false,
  globalIllumination: true,
  explorationEnabled: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeToken(overrides: Partial<Token> = {}): Token {
  return {
    id: 'tok-1',
    name: 'Goblin Scout',
    imageUrl: '',
    position: { x: 0, y: 19 },
    size: { width: 1, height: 1 },
    layer: TokenLayer.TOKEN,
    visible: true,
    type: TokenType.NPC,
    disposition: null,
    hp: null,
    showHpBar: false,
    notes: '',
    initiative: null,
    characterId: null,
    controlledBy: null,
    rotation: 0,
    conditions: [],
    metadata: {},
    ...overrides,
  };
}

function openTokenMenu(token: Token) {
  act(() => { useGameStore.getState().setTokens([token]); });
  const input = document.querySelector('canvas[class*="cursor-"]');
  if (!input) throw new Error('no input canvas');
  fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
}

beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null, configurable: true });
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', { value: RO, configurable: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  h.set({ userRole: 'DM', currentMap: testMap });
  h.updateToken.mockResolvedValue({ token: {} });
});

describe('Spirit layer toolbar button title', () => {
  it('displays "Spirit tokens shown, click to hide" when dmShowSpiritTokens is true and toggles to "Hiding spirit tokens (click to show)"', () => {
    render(<MapCanvas />);

    const button = screen.getByTitle('Spirit tokens shown, click to hide');
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByTitle('Hiding spirit tokens (click to show)')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Hiding spirit tokens (click to show)'));
    expect(screen.getByTitle('Spirit tokens shown, click to hide')).toBeInTheDocument();
  });

  it('does not render spirit layer toggle button for non-DM players', () => {
    h.set({ userRole: 'PLAYER' });
    render(<MapCanvas />);

    expect(screen.queryByTitle(/spirit tokens/i)).not.toBeInTheDocument();
  });
});

describe('Context menu action failure toast notifications', () => {
  describe('Hide / Reveal to players', () => {
    it('displays error toast with API error message when hiding a token fails', async () => {
      h.updateToken.mockRejectedValue({
        response: { data: { message: 'Cannot hide token during combat' } },
      });
      render(<MapCanvas />);
      openTokenMenu(makeToken({ visible: true }));

      await act(async () => {
        fireEvent.click(screen.getByText('Hide from Players'));
      });

      expect(h.showToast).toHaveBeenCalledWith('Cannot hide token during combat', 'error');
    });

    it('displays fallback error toast when hiding a token fails with a generic error', async () => {
      h.updateToken.mockRejectedValue(new Error('Network disconnected'));
      render(<MapCanvas />);
      openTokenMenu(makeToken({ visible: true }));

      await act(async () => {
        fireEvent.click(screen.getByText('Hide from Players'));
      });

      expect(h.showToast).toHaveBeenCalledWith('Failed to update token', 'error');
    });

    it('displays error toast with API error message when revealing a hidden token fails', async () => {
      h.updateToken.mockRejectedValue({
        response: { data: { message: 'Token cannot be revealed' } },
      });
      render(<MapCanvas />);
      openTokenMenu(makeToken({ visible: false }));

      await act(async () => {
        fireEvent.click(screen.getByText('Reveal to Players'));
      });

      expect(h.showToast).toHaveBeenCalledWith('Token cannot be revealed', 'error');
    });
  });

  describe('Obscure / Reveal identity', () => {
    it('displays error toast with API error message when obscuring token identity fails', async () => {
      h.updateToken.mockRejectedValue({
        response: { data: { message: 'Cannot obscure token identity' } },
      });
      render(<MapCanvas />);
      openTokenMenu(makeToken({ obscured: false }));

      await act(async () => {
        fireEvent.click(screen.getByText('Obscure Identity'));
      });

      expect(h.showToast).toHaveBeenCalledWith('Cannot obscure token identity', 'error');
    });

    it('displays fallback error toast when obscuring identity fails with a generic error', async () => {
      h.updateToken.mockRejectedValue(new Error('Server error'));
      render(<MapCanvas />);
      openTokenMenu(makeToken({ obscured: false }));

      await act(async () => {
        fireEvent.click(screen.getByText('Obscure Identity'));
      });

      expect(h.showToast).toHaveBeenCalledWith('Failed to update token', 'error');
    });

    it('displays error toast with API error message when revealing token identity fails', async () => {
      h.updateToken.mockRejectedValue({
        response: { data: { message: 'Cannot reveal token identity' } },
      });
      render(<MapCanvas />);
      openTokenMenu(makeToken({ obscured: true }));

      await act(async () => {
        fireEvent.click(screen.getByText('Reveal Identity'));
      });

      expect(h.showToast).toHaveBeenCalledWith('Cannot reveal token identity', 'error');
    });
  });

  describe('Spirit Realm toggle', () => {
    it('displays error toast with API error message when sending token to spirit realm fails', async () => {
      h.updateToken.mockRejectedValue({
        response: { data: { message: 'Spirit plane unreachable' } },
      });
      render(<MapCanvas />);
      openTokenMenu(makeToken({ layer: TokenLayer.TOKEN }));

      await act(async () => {
        fireEvent.click(screen.getByText('Send to Spirit Realm'));
      });

      expect(h.showToast).toHaveBeenCalledWith('Spirit plane unreachable', 'error');
    });

    it('displays fallback error toast when sending to spirit realm fails with generic error', async () => {
      h.updateToken.mockRejectedValue(new Error('Unknown failure'));
      render(<MapCanvas />);
      openTokenMenu(makeToken({ layer: TokenLayer.TOKEN }));

      await act(async () => {
        fireEvent.click(screen.getByText('Send to Spirit Realm'));
      });

      expect(h.showToast).toHaveBeenCalledWith('Failed to update token', 'error');
    });

    it('displays error toast with API error message when returning token to material plane fails', async () => {
      h.updateToken.mockRejectedValue({
        response: { data: { message: 'Material plane blocked' } },
      });
      render(<MapCanvas />);
      openTokenMenu(makeToken({ layer: TokenLayer.SPIRIT }));

      await act(async () => {
        fireEvent.click(screen.getByText('Return to Material Plane'));
      });

      expect(h.showToast).toHaveBeenCalledWith('Material plane blocked', 'error');
    });

    it('displays fallback error toast when returning to material plane fails with generic error', async () => {
      h.updateToken.mockRejectedValue(new Error('Connection lost'));
      render(<MapCanvas />);
      openTokenMenu(makeToken({ layer: TokenLayer.SPIRIT }));

      await act(async () => {
        fireEvent.click(screen.getByText('Return to Material Plane'));
      });

      expect(h.showToast).toHaveBeenCalledWith('Failed to update token', 'error');
    });
  });
});
