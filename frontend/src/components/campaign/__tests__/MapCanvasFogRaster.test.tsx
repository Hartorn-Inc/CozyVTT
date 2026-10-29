import { describe, it, expect, vi, beforeAll, beforeEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Map as CampaignMap, Token } from '@/types';
import { TokenType, TokenLayer } from '@/types';
import type { FogState } from '@/types/walls';
import * as fogRasterModule from '../map/fogRaster';
import * as layersModule from '../map/layers';

const h = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let version = 0;
  const state = {
    userRole: 'DM' as string,
    currentMap: null as CampaignMap | null,
    joinedEpoch: 1,
  };
  const handlers = new Map<string, Set<(data: never) => void>>();
  const sent: Array<[string, unknown]> = [];
  const raw = {
    connected: true,
    on(event: string, fn: (data: never) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
      return raw;
    },
    off(event: string, fn: (data: never) => void) {
      handlers.get(event)?.delete(fn);
      return raw;
    },
    emit(event: string, payload: unknown) {
      sent.push([event, payload]);
      return raw;
    },
  };
  return {
    state,
    handlers,
    sent,
    raw,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    snapshot: () => version,
    set(patch: Partial<typeof state>) {
      Object.assign(state, patch);
      version += 1;
      listeners.forEach((l) => l());
    },
    triggerSocket(event: string, payload: unknown) {
      const set = handlers.get(event);
      if (set) {
        set.forEach((fn) => fn(payload as never));
      }
    },
  };
});

vi.mock('@/contexts/CampaignContext', async () => {
  const { useSyncExternalStore } = await import('react');
  const setCurrentMap = (next: unknown) => {
    h.set({
      currentMap:
        typeof next === 'function'
          ? (next as (p: unknown) => unknown)(h.state.currentMap) as CampaignMap
          : (next as CampaignMap),
    });
  };
  const noop = () => undefined;
  const campaign = {
    id: 'campaign-1',
    name: 'Test',
    spiritLayerEnabled: false,
    memberships: [],
    characters: [],
  };
  return {
    useCampaign: () => {
      useSyncExternalStore(h.subscribe, h.snapshot);
      return {
        currentMap: h.state.currentMap,
        mapGeometryGen: 0,
        setCurrentMap,
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
  const client = new Proxy(
    {
      getSocket: () => h.raw,
      emitTokenMoveStart: (p: unknown) => { h.sent.push(['token.move.start', p]); },
      emitTokenMove: (p: unknown) => { h.sent.push(['token.move', p]); },
      emitTokenMoveEnd: (p: unknown) => { h.sent.push(['token.move.end', p]); },
    } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        return () => () => undefined;
      },
    }
  );
  return {
    useWebSocket: () => {
      useSyncExternalStore(h.subscribe, h.snapshot);
      return { socket: client, joinedEpoch: h.state.joinedEpoch, status: 'connected', reconnectCount: 0 };
    },
  };
});

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'player-1', displayName: 'Player 1' } }),
}));

vi.mock('@/services/map.service', () => ({
  default: { updateMap: vi.fn(), getMaps: vi.fn().mockResolvedValue([]), getMap: vi.fn() },
}));

vi.mock('@/services/api', () => {
  const client = new Proxy({}, { get: () => vi.fn().mockResolvedValue({}) });
  return { api: client, default: client };
});

import MapCanvas from '../MapCanvas';
import { useGameStore } from '@/stores/gameStore';

const testMap: CampaignMap = {
  id: 'map-1',
  campaignId: 'campaign-1',
  name: 'Test Map',
  imageUrl: '/api/assets/maps/test',
  width: 10,
  height: 10,
  gridSize: 50,
  tokens: [],
  wallSegments: [],
  lights: [],
  fogEnabled: true,
  lightingEnabled: false,
  globalIllumination: true,
  explorationEnabled: false,
} as unknown as CampaignMap;

const testFogState: FogState = {
  fogCols: 10,
  fogRows: 10,
  cellPx: 50,
  revealed: new Array(100).fill(false),
};

let rafQueue: FrameRequestCallback[] = [];
function flushRAF() {
  const cbs = [...rafQueue];
  rafQueue = [];
  cbs.forEach((cb) => cb(performance.now()));
}

class MockImage {
  private _src = '';
  crossOrigin = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 500;
  height = 500;
  get src() {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    setTimeout(() => {
      this.onload?.();
    }, 0);
  }
}

let buildFogRasterSpy: MockInstance<typeof fogRasterModule.buildFogRaster>;
let drawFogSpy: MockInstance<typeof layersModule.drawFog>;

beforeAll(() => {
  vi.stubGlobal('Image', MockImage);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', RO);

  const mockCtx = {
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 50 }),
    createImageData: vi.fn((w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    })),
    putImageData: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    })),
  };
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx);
});

beforeEach(() => {
  h.handlers.clear();
  h.sent.length = 0;
  rafQueue = [];
  useGameStore.getState().setTokens([]);
  buildFogRasterSpy = vi.spyOn(fogRasterModule, 'buildFogRaster');
  drawFogSpy = vi.spyOn(layersModule, 'drawFog');
});

function getCanvasSurface(): HTMLCanvasElement {
  const input = document.querySelector<HTMLCanvasElement>('canvas[class*="cursor-"]');
  if (!input) throw new Error('no input canvas');
  return input;
}

describe('MapCanvas Fog Raster Caching and Memoization', () => {
  it('memoizes playerFogRaster and recalculates only when viewerRevealed or currentMap dimensions change', async () => {
    h.set({ userRole: 'PLAYER', currentMap: testMap });
    render(<MapCanvas />);

    const playerCallsInitial = buildFogRasterSpy.mock.calls.filter((c) => c[2] === false);
    expect(playerCallsInitial.length).toBeGreaterThanOrEqual(1);
    const initialPlayerCallCount = playerCallsInitial.length;

    // Trigger re-render with identical inputs
    act(() => {
      h.set({ userRole: 'PLAYER' });
    });
    const playerCallsAfterNoop = buildFogRasterSpy.mock.calls.filter((c) => c[2] === false);
    expect(playerCallsAfterNoop.length).toBe(initialPlayerCallCount);

    // Update viewerRevealed via websocket event fog:cells
    act(() => {
      h.triggerSocket('fog:cells', { mapId: testMap.id, revealedCells: [0, 1, 2] });
    });
    const playerCallsAfterRevealedChange = buildFogRasterSpy.mock.calls.filter((c) => c[2] === false);
    expect(playerCallsAfterRevealedChange.length).toBeGreaterThan(initialPlayerCallCount);

    const countBeforeDimensionChange = playerCallsAfterRevealedChange.length;
    // Change map dimensions
    act(() => {
      h.set({
        currentMap: { ...testMap, width: 15, height: 12 },
      });
    });
    const playerCallsAfterDimensionChange = buildFogRasterSpy.mock.calls.filter((c) => c[2] === false);
    expect(playerCallsAfterDimensionChange.length).toBeGreaterThan(countBeforeDimensionChange);
  });

  it('memoizes dmFogRaster and recalculates only when effectiveFogState dimensions or revealed array change', async () => {
    h.set({ userRole: 'DM', currentMap: testMap });
    render(<MapCanvas />);

    // Initially fogState is null, so dmFogRaster is null
    const dmCallsInitial = buildFogRasterSpy.mock.calls.filter((c) => c[2] === true);
    const initialCount = dmCallsInitial.length;

    // Server sends fog:updated
    act(() => {
      h.triggerSocket('fog:updated', { mapId: testMap.id, fogState: testFogState });
    });
    const dmCallsAfterState = buildFogRasterSpy.mock.calls.filter((c) => c[2] === true);
    expect(dmCallsAfterState.length).toBeGreaterThan(initialCount);
    const countAfterState = dmCallsAfterState.length;

    // Re-render with same fogState dimensions and revealed array
    act(() => {
      h.set({ userRole: 'DM' });
    });
    const dmCallsAfterNoop = buildFogRasterSpy.mock.calls.filter((c) => c[2] === true);
    expect(dmCallsAfterNoop.length).toBe(countAfterState);

    // Update revealed array via fog:updated with a new revealed array
    const updatedRevealed = [...testFogState.revealed];
    updatedRevealed[0] = true;
    act(() => {
      h.triggerSocket('fog:updated', {
        mapId: testMap.id,
        fogState: { ...testFogState, revealed: updatedRevealed },
      });
    });
    const dmCallsAfterRevealedChange = buildFogRasterSpy.mock.calls.filter((c) => c[2] === true);
    expect(dmCallsAfterRevealedChange.length).toBeGreaterThan(countAfterState);

    const countBeforeDimChange = dmCallsAfterRevealedChange.length;
    // Update fog dimensions
    act(() => {
      h.triggerSocket('fog:updated', {
        mapId: testMap.id,
        fogState: { ...testFogState, fogCols: 20, fogRows: 20 },
      });
    });
    const dmCallsAfterDimChange = buildFogRasterSpy.mock.calls.filter((c) => c[2] === true);
    expect(dmCallsAfterDimChange.length).toBeGreaterThan(countBeforeDimChange);
  });

  it('does not recalculate playerFogRaster or dmFogRaster on pointer moves, token drag, ruler, or aoe tools', async () => {
    h.set({ userRole: 'PLAYER', currentMap: testMap });
    const playerToken: Token = {
      id: 'token-player',
      characterId: 'char-1',
      name: 'Hero',
      imageUrl: '/api/assets/tokens/hero',
      position: { x: 2, y: 2 },
      size: { width: 1, height: 1 },
      layer: TokenLayer.TOKEN,
      visible: true,
      controlledBy: 'player-1',
      type: TokenType.PLAYER,
      conditions: [],
    } as unknown as Token;

    render(<MapCanvas />);
    act(() => {
      useGameStore.getState().setTokens([playerToken]);
    });

    const countBeforeInteractions = buildFogRasterSpy.mock.calls.length;
    const surface = getCanvasSurface();

    // 1. Mouse move (hoverCoords change)
    fireEvent.mouseMove(surface, { clientX: 120, clientY: 120 });
    fireEvent.mouseMove(surface, { clientX: 180, clientY: 180 });
    expect(buildFogRasterSpy.mock.calls.length).toBe(countBeforeInteractions);

    // 2. Token drag
    fireEvent.mouseDown(surface, { clientX: 110, clientY: 860, button: 0, buttons: 1 });
    fireEvent.mouseMove(surface, { clientX: 250, clientY: 500, buttons: 1 });
    expect(buildFogRasterSpy.mock.calls.length).toBe(countBeforeInteractions);

    // 3. Ruler tool toggle
    const rulerBtn = screen.getByTitle(/Ruler — measure distance/i);
    fireEvent.click(rulerBtn);
    expect(buildFogRasterSpy.mock.calls.length).toBe(countBeforeInteractions);

    // 4. AoE tool toggle
    const aoeBtn = screen.getByTitle(/AoE Shape — area of effect overlay/i);
    fireEvent.click(aoeBtn);
    expect(buildFogRasterSpy.mock.calls.length).toBe(countBeforeInteractions);
  });

  it('allocates fogScratchRef once and passes it to both DM terrain drawFog and player overlay drawFog', async () => {
    h.set({ userRole: 'DM', currentMap: testMap });
    render(<MapCanvas />);

    // Load DM fog state
    act(() => {
      h.triggerSocket('fog:updated', { mapId: testMap.id, fogState: testFogState });
    });

    // Wait for map image loading
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      flushRAF();
    });

    // Verify drawFog call on terrain for DM view
    const dmDrawCalls = drawFogSpy.mock.calls.filter((c) => c[1].isDM === true);
    expect(dmDrawCalls.length).toBeGreaterThanOrEqual(1);
    const dmFirstCall = dmDrawCalls[0]![1];
    expect(dmFirstCall.raster).toBeInstanceOf(HTMLCanvasElement);
    expect(dmFirstCall.scratchCanvas).toBeInstanceOf(HTMLCanvasElement);
    const sharedScratchCanvas = dmFirstCall.scratchCanvas;

    // Switch to player view on the same mounted canvas
    act(() => {
      h.set({ userRole: 'PLAYER' });
      h.triggerSocket('fog:cells', { mapId: testMap.id, revealedCells: [1, 2] });
    });

    await act(async () => {
      flushRAF();
    });

    // Verify drawFog call on overlay for player view
    const playerDrawCalls = drawFogSpy.mock.calls.filter((c) => c[1].isDM === false);
    expect(playerDrawCalls.length).toBeGreaterThanOrEqual(1);
    const playerFirstCall = playerDrawCalls[playerDrawCalls.length - 1]![1];
    expect(playerFirstCall.raster).toBeInstanceOf(HTMLCanvasElement);
    // Transmits the exact same scratch canvas instance without reallocation
    expect(playerFirstCall.scratchCanvas).toBe(sharedScratchCanvas);
  });

  it('keeps player-owned tokens visible through fog by transmitting ownTokenCells as exemptCells', async () => {
    h.set({ userRole: 'PLAYER', currentMap: testMap });
    const myToken: Token = {
      id: 'my-char-token',
      characterId: 'char-1',
      name: 'Paladin',
      imageUrl: '/api/assets/tokens/paladin',
      position: { x: 3, y: 4 },
      size: { width: 1, height: 1 },
      layer: 'material' as TokenLayer,
      visible: true,
      controlledBy: 'player-1',
      type: TokenType.PLAYER,
      conditions: [],
    } as unknown as Token;

    render(<MapCanvas />);

    act(() => {
      useGameStore.getState().setTokens([myToken]);
      h.triggerSocket('fog:cells', { mapId: testMap.id, revealedCells: [] });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      flushRAF();
    });

    const playerDrawCalls = drawFogSpy.mock.calls.filter((c) => c[1].isDM === false);
    expect(playerDrawCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = playerDrawCalls[playerDrawCalls.length - 1]![1];

    // ownTokenCells must be populated and transmitted as exemptCells
    expect(lastCall.exemptCells).toBeInstanceOf(Set);
    expect((lastCall.exemptCells as Set<number>).size).toBe(1);
  });
});
