/**
 * Campaign load and catch-up recovery on the table page.
 *
 * A failed campaign GET keeps the existing error card: Retry on recoverable
 * failures, no Retry on 403. A settings-style refresh must not swap the table
 * for the full-page spinner. Map-pane and catch-up errors stay on the table.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const anySocket = vi.hoisted(() => new Proxy({}, { get: () => () => undefined }));
const loadCampaign = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const retryMapLoad = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const catchUpAfterReconnect = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

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
  retryMapLoad.mockResolvedValue(undefined);
  catchUpAfterReconnect.mockResolvedValue(undefined);
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

    expect(screen.getByRole('alert')).toHaveTextContent('You do not have permission to view this campaign');
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
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(catchUpAfterReconnect).toHaveBeenCalledTimes(1);
  });
});
