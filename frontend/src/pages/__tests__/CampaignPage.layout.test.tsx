/**
 * Focus table chrome: the map and tray are on every width; the session rail
 * sits beside them on a wide viewport, and Party/Session become drawers below lg.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WIDE_VIEWPORT_QUERY } from '@/hooks/useWideViewport';

const campaignState = vi.hoisted(() => ({
  userRole: 'DM' as 'DM' | 'PLAYER' | 'SPECTATOR',
}));

const anySocket = vi.hoisted(() => new Proxy({}, { get: () => () => undefined }));

function installMatchMedia(wide: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: query === WIDE_VIEWPORT_QUERY ? wide : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'campaign-1' }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'dm', displayName: 'DM' } }),
}));
vi.mock('@/contexts/CampaignContext', () => ({
  CampaignProvider: ({ children }: { children?: unknown }) => <>{children as never}</>,
  useCampaign: () => ({
    campaign: {
      id: 'campaign-1',
      name: 'Test',
      status: 'ACTIVE',
      ownerId: 'dm',
      memberships: [],
      characters: [],
    },
    currentMap: { id: 'map-1', name: 'Map', tokens: [] },
    loading: false,
    error: null,
    userRole: campaignState.userRole,
    updateCampaignStatus: vi.fn(),
    setActiveSession: vi.fn(),
    refreshCurrentMap: vi.fn(),
    catchUpAfterReconnect: vi.fn(),
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
vi.mock('@/components/campaign/CampaignInfo', () => ({
  default: () => <p>Campaign info</p>,
}));
vi.mock('@/components/campaign/CampaignRoster', () => ({
  default: () => <p>Campaign roster</p>,
}));
vi.mock('@/components/campaign/MapManager', nothing);
vi.mock('@/components/campaign/TokenManager', nothing);
vi.mock('@/components/campaign/SpiritLayerControls', nothing);
vi.mock('@/components/campaign/AtmospherePanel', nothing);
vi.mock('@/components/campaign/AtmospherePlayer', nothing);
vi.mock('@/components/campaign/CreatureLibrary', nothing);
vi.mock('@/components/campaign/TokenTemplateLibrary', nothing);
vi.mock('@/components/campaign/CampaignSettingsModal', nothing);
vi.mock('@/components/documents/CampaignDocumentsModal', nothing);
vi.mock('@/components/campaign/NpcQuickEditor', nothing);
vi.mock('@/components/campaign/TokenRoster', () => ({
  default: () => <p>Token roster</p>,
}));
vi.mock('@/components/campaign/SessionSidebar', () => ({
  default: ({ requestedTab }: { requestedTab?: string | null }) => (
    <div>
      Session rail
      {requestedTab ? <span>Tab: {requestedTab}</span> : null}
    </div>
  ),
}));
vi.mock('@/components/ConnectionStatus', nothing);
vi.mock('@/components/campaign/MapCanvas', () => ({
  default: ({ onFocusToken }: { onFocusToken?: (id: string | null) => void }) => (
    <div>
      <span>Map surface</span>
      <button type="button" onClick={() => onFocusToken?.('tok-1')}>
        Select token
      </button>
    </div>
  ),
}));
vi.mock('@/components/campaign/ContextualTray', () => ({
  default: ({
    isWide,
    onOpenParty,
    onOpenSession,
    onOpenInitiative,
  }: {
    isWide: boolean;
    onOpenParty: () => void;
    onOpenSession: () => void;
    onOpenInitiative: () => void;
  }) => (
    <div aria-label="Table actions">
      Table actions
      {!isWide && (
        <>
          <button type="button" onClick={onOpenParty}>Party</button>
          <button type="button" onClick={onOpenSession}>Session</button>
          <button type="button" onClick={onOpenInitiative}>Initiative</button>
        </>
      )}
    </div>
  ),
}));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import CampaignPage from '../CampaignPage';

beforeEach(() => {
  campaignState.userRole = 'DM';
});

describe('CampaignPage focus table layout', () => {
  it('shows the map and tray on a narrow viewport, without Desktop Required or three columns', async () => {
    installMatchMedia(false);
    render(<CampaignPage />);

    expect(screen.queryByText('Desktop Required')).toBeNull();
    expect(await screen.findByText('Map surface')).toBeInTheDocument();
    expect(screen.getByLabelText('Table actions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show party panel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide party panel' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite Player' })).toBeNull();
  });

  it('shows the session tool rail together with the map on a wide viewport', async () => {
    installMatchMedia(true);
    render(<CampaignPage />);

    expect(await screen.findByText('Map surface')).toBeInTheDocument();
    expect(screen.getByText('Session rail')).toBeInTheDocument();
    expect(screen.getByLabelText('Table actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide party panel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide session panel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Party' })).toBeNull();
  });

  it('lets a DM reach initiative, the party roster, and map tools on a narrow viewport', async () => {
    installMatchMedia(false);
    render(<CampaignPage />);
    await screen.findByText('Map surface');

    fireEvent.click(screen.getByRole('button', { name: 'Initiative' }));
    const session = screen.getByRole('dialog', { name: 'Session' });
    expect(session).toHaveTextContent('Session rail');
    expect(session).toHaveTextContent('Tab: initiative');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Party' }));
    expect(screen.getByRole('dialog', { name: 'Party' })).toHaveTextContent('Campaign roster');
    expect(screen.getByRole('dialog', { name: 'Party' })).toHaveTextContent('Token roster');

    fireEvent.click(screen.getByRole('button', { name: 'DM tools' }));
    expect(screen.getByRole('dialog', { name: 'DM tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Map Library' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Token Manager' })).toHaveTextContent('Token Manager');

    fireEvent.click(screen.getByRole('button', { name: 'Party' }));
    expect(screen.queryByRole('dialog', { name: 'DM tools' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Party' })).toBeInTheDocument();
  });
});
