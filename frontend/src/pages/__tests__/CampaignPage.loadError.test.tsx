/**
 * Campaign load and catch-up recovery on the table page.
 *
 * A failed campaign GET keeps the existing error card: Retry on recoverable
 * failures, no Retry on 403. A settings-style refresh must not swap the table
 * for the full-page spinner. Map-pane and catch-up errors stay on the table.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const anySocket = vi.hoisted(() => new Proxy({}, { get: () => () => undefined }));
const loadCampaign = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const retryMapLoad = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, message: 'Map loaded' }));
const catchUpAfterReconnect = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, message: 'Table synced' }));

const ctx = vi.hoisted(() => ({
  campaign: null as { id: string; name: string; status: string; ownerId: string; memberships: unknown[]; characters: unknown[] } | null,
  currentMap: null as { id: string; name: string; tokens: unknown[] } | null,
  loading: false,
  error: null as string | null,
  errorRetryable: false,
  mapLoadError: null as { mapId: string; message: string } | null,
  syncError: null as string | null,
  userRole: 'DM' as string | null,
}));

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'campaign-1' }),
}));
vi.mock('react-resizable-panels', () => {
  const Box = ({ children }: { children?: unknown }) => <div>{children as never}</div>;
  return {
    Group: Box,
    Panel: Box,
    Separator: () => null,
    useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: () => undefined }),
    usePanelRef: () => ({ current: null }),
  };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'dm', displayName: 'DM' } }) }));
vi.mock('@/contexts/CampaignContext', () => ({
  CampaignProvider: ({ children }: { children?: unknown }) => <>{children as never}</>,
  useCampaign: () => ({
    campaign: ctx.campaign,
    currentMap: ctx.currentMap,
    loading: ctx.loading,
    error: ctx.error,
    errorRetryable: ctx.errorRetryable,
    mapLoadError: ctx.mapLoadError,
    syncError: ctx.syncError,
    userRole: ctx.userRole,
    updateCampaignStatus: vi.fn(),
    setActiveSession: vi.fn(),
    refreshCurrentMap: vi.fn(),
    catchUpAfterReconnect,
    loadCampaign,
    retryMapLoad,
  }),
}));
vi.mock('@/contexts/WebSocketContext', () => ({
  WebSocketProvider: ({ children }: { children?: unknown }) => <>{children as never}</>,
  useWebSocket: () => ({ socket: anySocket, joinedEpoch: 1, status: 'connected' }),
}));
vi.mock('@/hooks/useInitiativeSync', () => ({ useInitiativeSync: () => undefined }));
vi.mock('@/hooks/useOnRejoin', () => ({ useOnRejoin: () => undefined }));
vi.mock('@/hooks/useAccessRevoked', () => ({ useAccessRevoked: () => undefined }));

const nothing = vi.hoisted(() => () => ({ default: () => null }));
vi.mock('@/components/campaign/CampaignInfo', nothing);
vi.mock('@/components/campaign/CampaignRoster', nothing);
vi.mock('@/components/campaign/MapManager', nothing);
vi.mock('@/components/campaign/TokenManager', nothing);
vi.mock('@/components/campaign/SpiritLayerControls', nothing);
vi.mock('@/components/campaign/AtmospherePanel', nothing);
vi.mock('@/components/campaign/AtmospherePlayer', nothing);
vi.mock('@/components/campaign/CreatureLibrary', nothing);
vi.mock('@/components/campaign/TokenTemplateLibrary', nothing);
vi.mock('@/components/campaign/CampaignSettingsModal', nothing);
vi.mock('@/components/documents/CampaignDocumentsModal', nothing);
vi.mock('@/components/campaign/SessionSidebar', nothing);
vi.mock('@/components/campaign/SessionToolbar', nothing);
vi.mock('@/components/ConnectionStatus', nothing);
vi.mock('@/components/campaign/MapCanvas', nothing);
vi.mock('@/components/campaign/TokenRoster', nothing);
vi.mock('@/components/campaign/NpcQuickEditor', nothing);

import CampaignPage from '../CampaignPage';
import type { TableRetryOutcome } from '@/contexts/CampaignContext';

const loadedCampaign = {
  id: 'campaign-1',
  name: 'The Keep',
  status: 'ACTIVE',
  ownerId: 'dm',
  memberships: [],
  characters: [],
};

beforeEach(() => {
  loadCampaign.mockReset();
  retryMapLoad.mockReset();
  catchUpAfterReconnect.mockReset();
  loadCampaign.mockResolvedValue(undefined);
  retryMapLoad.mockResolvedValue({ ok: true, message: 'Map loaded' });
  catchUpAfterReconnect.mockResolvedValue({ ok: true, message: 'Table synced' });
  ctx.campaign = null;
  ctx.currentMap = null;
  ctx.loading = false;
  ctx.error = null;
  ctx.errorRetryable = false;
  ctx.mapLoadError = null;
  ctx.syncError = null;
  ctx.userRole = 'DM';
});

describe('CampaignPage load and recovery', () => {
  it('shows Retry on a recoverable campaign GET failure', () => {
    ctx.error = 'Failed to load campaign';
    ctx.errorRetryable = true;
    render(<CampaignPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load campaign');
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toHaveAttribute('aria-describedby', 'campaign-load-error');
    expect(screen.getByRole('button', { name: /Back to Dashboard/ })).toBeTruthy();

    fireEvent.click(retry);
    expect(loadCampaign).toHaveBeenCalledWith('campaign-1');
  });

  it('hides Retry on a 403 campaign GET failure', () => {
    ctx.error = 'You do not have permission to view this campaign';
    ctx.errorRetryable = false;
    render(<CampaignPage />);

    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'You do not have permission to view this campaign',
    });
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have permission to view this campaign');
    expect(heading).toHaveAttribute('tabIndex', '-1');
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: /Back to Dashboard/ })).toBeTruthy();
  });

  it('does not use the full-page spinner when a loaded campaign is refreshing', () => {
    ctx.campaign = loadedCampaign;
    ctx.currentMap = { id: 'map-1', name: 'Map', tokens: [] };
    ctx.loading = true;
    render(<CampaignPage />);

    expect(screen.queryByText('Loading campaign...')).toBeNull();
    expect(screen.getByRole('heading', { name: 'The Keep' })).toBeTruthy();
  });

  it('hides the map error overlay once another map is showing', () => {
    ctx.campaign = loadedCampaign;
    ctx.currentMap = { id: 'map-2', name: 'Other', tokens: [] };
    ctx.mapLoadError = { mapId: 'map-1', message: 'Map unavailable' };
    render(<CampaignPage />);

    expect(screen.getByRole('heading', { name: 'The Keep' })).toBeTruthy();
    expect(screen.queryByText('Map unavailable')).toBeNull();
  });

  it('keeps campaign chrome and offers map Retry when the first getMap fails', () => {
    ctx.campaign = loadedCampaign;
    ctx.mapLoadError = { mapId: 'map-1', message: 'Map unavailable' };
    render(<CampaignPage />);

    expect(screen.getByRole('heading', { name: 'The Keep' })).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('Map unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry map load' }));
    expect(retryMapLoad).toHaveBeenCalledTimes(1);
    expect(loadCampaign).not.toHaveBeenCalled();
  });

  it('shows a catch-up Retry banner without replacing the table', () => {
    ctx.campaign = loadedCampaign;
    ctx.currentMap = { id: 'map-1', name: 'Map', tokens: [] };
    ctx.syncError = 'Failed to refresh the current map';
    render(<CampaignPage />);

    expect(screen.getByRole('heading', { name: 'The Keep' })).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to refresh the current map');
    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
    expect(catchUpAfterReconnect).toHaveBeenCalledTimes(1);
  });

  it('shows distinct Retry names when both map and sync errors are set', () => {
    ctx.campaign = loadedCampaign;
    ctx.currentMap = { id: 'map-1', name: 'Map', tokens: [] };
    ctx.mapLoadError = { mapId: 'map-1', message: 'Map unavailable' };
    ctx.syncError = 'Failed to refresh the current map';
    render(<CampaignPage />);

    expect(screen.getByRole('button', { name: 'Retry map load' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry sync' })).toBeTruthy();
  });

  it('keeps Retry map load focusable while the request is in flight', async () => {
    let release: (value: TableRetryOutcome) => void = () => {};
    retryMapLoad.mockImplementation(
      () => new Promise<TableRetryOutcome>((resolve) => { release = resolve; }),
    );
    ctx.campaign = loadedCampaign;
    ctx.mapLoadError = { mapId: 'map-1', message: 'Map unavailable' };
    render(<CampaignPage />);

    const retry = screen.getByRole('button', { name: 'Retry map load' });
    fireEvent.click(retry);
    expect(retry).not.toBeDisabled();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(retry).toBeTruthy();
    await waitFor(() => {
      expect(document.getElementById('campaign-map-retry-status')).toHaveTextContent('Retrying map load');
    });

    await act(async () => { release({ ok: false, message: 'Map unavailable' }); });
  });

  it('announces a successful map retry in the live region', async () => {
    let release: (value: TableRetryOutcome) => void = () => {};
    retryMapLoad.mockImplementation(
      () => new Promise<TableRetryOutcome>((resolve) => { release = resolve; }),
    );
    ctx.campaign = loadedCampaign;
    ctx.mapLoadError = { mapId: 'map-1', message: 'Map unavailable' };
    render(<CampaignPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry map load' }));
    await act(async () => { release({ ok: true, message: 'Map loaded' }); });
    await waitFor(() => {
      expect(document.getElementById('campaign-map-retry-status')).toHaveTextContent('Map loaded');
    });
  });

  it('announces a successful sync retry in the live region', async () => {
    let release: (value: TableRetryOutcome) => void = () => {};
    catchUpAfterReconnect.mockImplementation(
      () => new Promise<TableRetryOutcome>((resolve) => { release = resolve; }),
    );
    ctx.campaign = loadedCampaign;
    ctx.currentMap = { id: 'map-1', name: 'Map', tokens: [] };
    ctx.syncError = 'Failed to refresh the current map';
    render(<CampaignPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
    await act(async () => { release({ ok: true, message: 'Table synced' }); });
    await waitFor(() => {
      expect(document.getElementById('campaign-sync-retry-status')).toHaveTextContent('Table synced');
    });
  });

  it('announces the settled failure message, not the closed-over mapLoadError', async () => {
    retryMapLoad.mockResolvedValue({ ok: false, message: 'Map timed out' });
    ctx.campaign = loadedCampaign;
    ctx.mapLoadError = { mapId: 'map-1', message: 'Map unavailable' };
    render(<CampaignPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry map load' }));
    await waitFor(() => {
      expect(document.getElementById('campaign-map-retry-status')).toHaveTextContent('Map timed out');
    });
    expect(ctx.mapLoadError.message).toBe('Map unavailable');
  });

  it('announces a repeated map-load failure even when the error text is unchanged', async () => {
    retryMapLoad.mockResolvedValue({ ok: false, message: 'Map unavailable' });
    ctx.campaign = loadedCampaign;
    ctx.mapLoadError = { mapId: 'map-1', message: 'Map unavailable' };
    render(<CampaignPage />);

    const retry = screen.getByRole('button', { name: 'Retry map load' });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(document.getElementById('campaign-map-retry-status')).toHaveTextContent('Map unavailable');
    });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(document.getElementById('campaign-map-retry-status')).toHaveTextContent('Map unavailable');
    });
    expect(retryMapLoad).toHaveBeenCalledTimes(2);
  });

  it('keeps map and sync retry announcements independent while both are in flight', async () => {
    let releaseMap: (value: TableRetryOutcome) => void = () => {};
    let releaseSync: (value: TableRetryOutcome) => void = () => {};
    retryMapLoad.mockImplementation(
      () => new Promise<TableRetryOutcome>((resolve) => { releaseMap = resolve; }),
    );
    catchUpAfterReconnect.mockImplementation(
      () => new Promise<TableRetryOutcome>((resolve) => { releaseSync = resolve; }),
    );
    ctx.campaign = loadedCampaign;
    ctx.currentMap = { id: 'map-1', name: 'Map', tokens: [] };
    ctx.mapLoadError = { mapId: 'map-1', message: 'Map unavailable' };
    ctx.syncError = 'Failed to refresh the current map';
    render(<CampaignPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry map load' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
    await waitFor(() => {
      expect(document.getElementById('campaign-map-retry-status')).toHaveTextContent('Retrying map load');
      expect(document.getElementById('campaign-sync-retry-status')).toHaveTextContent('Retrying sync');
    });

    await act(async () => { releaseMap({ ok: false, message: 'Map timed out' }); });
    await waitFor(() => {
      expect(document.getElementById('campaign-map-retry-status')).toHaveTextContent('Map timed out');
    });
    expect(document.getElementById('campaign-sync-retry-status')).toHaveTextContent('Retrying sync');

    await act(async () => { releaseSync({ ok: false, message: 'Table busy' }); });
    await waitFor(() => {
      expect(document.getElementById('campaign-sync-retry-status')).toHaveTextContent('Table busy');
    });
    expect(document.getElementById('campaign-map-retry-status')).toHaveTextContent('Map timed out');
  });

  it('does not announce a discarded map retry in the live region', async () => {
    let release: (value: TableRetryOutcome) => void = () => {};
    retryMapLoad.mockImplementation(
      () => new Promise<TableRetryOutcome>((resolve) => { release = resolve; }),
    );
    ctx.campaign = loadedCampaign;
    ctx.mapLoadError = { mapId: 'map-1', message: 'Map unavailable' };
    render(<CampaignPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry map load' }));
    await waitFor(() => {
      expect(document.getElementById('campaign-map-retry-status')).toHaveTextContent('Retrying map load');
    });

    await act(async () => { release({ discarded: true }); });
    expect(document.getElementById('campaign-map-retry-status')).toHaveTextContent('Retrying map load');
    expect(document.getElementById('campaign-map-retry-status')).not.toHaveTextContent('Failed to load map');
  });

  it('does not announce a discarded catch-up after a later map retry started', async () => {
    let releaseSync: (value: TableRetryOutcome) => void = () => {};
    catchUpAfterReconnect.mockImplementation(
      () => new Promise<TableRetryOutcome>((resolve) => { releaseSync = resolve; }),
    );
    retryMapLoad.mockResolvedValue({ ok: true, message: 'Map loaded' });
    ctx.campaign = loadedCampaign;
    ctx.currentMap = { id: 'map-1', name: 'Map', tokens: [] };
    ctx.mapLoadError = { mapId: 'map-1', message: 'Map unavailable' };
    ctx.syncError = 'Failed to refresh the current map';
    render(<CampaignPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
    await waitFor(() => {
      expect(document.getElementById('campaign-sync-retry-status')).toHaveTextContent('Retrying sync');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry map load' }));
    await waitFor(() => {
      expect(document.getElementById('campaign-map-retry-status')).toHaveTextContent('Retrying map load');
    });

    await act(async () => { releaseSync({ discarded: true }); });
    expect(document.getElementById('campaign-sync-retry-status')).toHaveTextContent('Retrying sync');
    expect(document.getElementById('campaign-sync-retry-status')).not.toHaveTextContent('Failed to catch up after reconnect');
  });
});
