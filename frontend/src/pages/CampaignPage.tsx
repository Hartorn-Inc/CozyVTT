// ============================================
// Campaign Page
// Focus table: current turn + map + contextual tray at every width.
// Wide (≥ 1024px): that surface plus persistent party and session rails.
// Narrow: the same surface; party/session stay mounted as overlay drawers.
// MapCanvas is one tree — CSS/overlay, never a wide ? Group : other fork.
// ============================================

import { useState, useEffect, lazy, Suspense } from 'react';
import { isCampaignOwner } from '@/utils/campaignRoles';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router';
import { CampaignProvider, useCampaign } from '@/contexts/CampaignContext';
import { WebSocketProvider, useWebSocket } from '@/contexts/WebSocketContext';
import { useGameStore } from '@/stores/gameStore';
import { useInitiativeSync } from '@/hooks/useInitiativeSync';
import { useWideViewport } from '@/hooks/useWideViewport';
import {
  ArrowLeft,
  Loader2,
  Sun,
  PauseCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen, Settings, BookOpen } from 'lucide-react';

// Campaign components
import CampaignInfo from '@/components/campaign/CampaignInfo';
import CampaignRoster from '@/components/campaign/CampaignRoster';
// Lazy-loaded — MapCanvas is by far the largest component in the app; splitting
// it into its own chunk keeps the CampaignPage shell fast to load and paints
// the sidebars while the canvas code downloads.
const MapCanvas = lazy(() => import('@/components/campaign/MapCanvas'));
import MapManager from '@/components/campaign/MapManager';
import TokenManager from '@/components/campaign/TokenManager';
import SpiritLayerControls from '@/components/campaign/SpiritLayerControls';
import AtmospherePanel from '@/components/campaign/AtmospherePanel';
import AtmospherePlayer from '@/components/campaign/AtmospherePlayer';
import NpcQuickEditor from '@/components/campaign/NpcQuickEditor';
import CreatureLibrary from '@/components/campaign/CreatureLibrary';
import TokenTemplateLibrary from '@/components/campaign/TokenTemplateLibrary';
import TokenRoster from '@/components/campaign/TokenRoster';
import CampaignSettingsModal from '@/components/campaign/CampaignSettingsModal';
import CampaignDocumentsModal from '@/components/documents/CampaignDocumentsModal';
import SessionSidebar, { type SessionRailTab } from '@/components/campaign/SessionSidebar';
import { type SessionToolKey } from '@/components/campaign/SessionToolbar';
import CurrentTurnBar from '@/components/campaign/CurrentTurnBar';
import ContextualTray from '@/components/campaign/ContextualTray';
import TableDrawer from '@/components/campaign/TableDrawer';
import DmToolsMenu from '@/components/campaign/DmToolsMenu';
import ConnectionStatus from '@/components/ConnectionStatus';
import { CampaignStatus } from '@/types';
import type { Token } from '@/types';
import Button from '@/components/ui/Button';
import Tooltip from '@/components/ui/Tooltip';
import { useOnRejoin } from '@/hooks/useOnRejoin';
import { useAccessRevoked } from '@/hooks/useAccessRevoked';

// ============================================
// Campaign Page Content (inside provider)
// ============================================

function CampaignPageContent() {
  const navigate = useNavigate();
  const { campaign, currentMap, loading, error, userRole, updateCampaignStatus, setActiveSession, refreshCurrentMap, catchUpAfterReconnect } = useCampaign();
  const { user } = useAuth();

  /**
   * Owning a campaign and running it are different things once the DM seat can
   * move. The owner keeps the powers that are theirs — deleting the campaign,
   * and taking the seat back — so they need a way into the settings panel even
   * when somebody else is the DM. Without this, handing the game over left the
   * campaign with nobody able to delete it: the owner had the permission and no
   * route to it, the new DM had the route and no permission.
   */
  const isOwner = isCampaignOwner(campaign, user?.id);
  const canOpenSettings = userRole === 'DM' || isOwner;
  const { socket, joinedEpoch, status } = useWebSocket();

  // Mirror combat/initiative state into the game store. Owned here rather than
  // by the initiative panel so both the tracker and the map's active-token
  // ring read one source, and so the subscription survives the panel being
  // collapsed or unmounted.
  useInitiativeSync();

  // After a WebSocket reconnect, catch up via REST. The real-time stream
  // only pushes deltas; moves, wall edits and fog ops, a pause or an end, a
  // member's new role and a switch to another map that broadcast while this
  // client was offline are not replayed, so without this the page stays on
  // its pre-disconnect state until the next live event arrives (or a hard
  // refresh). Once the connection has joined the campaign again, so nothing
  // sent while the read is in flight is missed.
  useOnRejoin(joinedEpoch, catchUpAfterReconnect);

  // Removed from the campaign, the campaign deleted, or the sign-in ended
  // elsewhere: say why and leave the table.
  useAccessRevoked();

  // A player changing their character's token image rewrites the image on every
  // token bound to that character, server-side — tokens hold their own copy. The
  // map has to refetch to show it, but only when tokens really changed: this
  // event also fires for every HP tweak and sheet save.
  useEffect(() => {
    if (!socket) return;
    const handleCharacterUpdated = (data: { tokensChanged?: boolean }) => {
      if (data?.tokensChanged) refreshCurrentMap();
    };
    socket.on('character.updated', handleCharacterUpdated);
    return () => {
      socket.off('character.updated', handleCharacterUpdated);
    };
    // refreshCurrentMap MUST be a dependency. It is a useCallback keyed on the
    // campaign and map ids, so its identity changes once they load. Keyed on
    // `socket` alone this effect would run once and capture the version built
    // before either existed — whose body returns immediately — and the refresh
    // would silently never happen. (`socket` is a module singleton, so it never
    // changes identity and cannot re-trigger this on its own.)
  }, [socket, refreshCurrentMap]);
  const [isMapManagerOpen, setIsMapManagerOpen] = useState(false);
  const [isTokenManagerOpen, setIsTokenManagerOpen] = useState(false);
  const [isSpiritLayerOpen, setIsSpiritLayerOpen] = useState(false);
  const [isAtmospherePanelOpen, setIsAtmospherePanelOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDocumentsOpen, setIsDocumentsOpen] = useState(false);
  const [isCreatureLibraryOpen, setIsCreatureLibraryOpen] = useState(false);
  const [isTokenTemplateLibraryOpen, setIsTokenTemplateLibraryOpen] = useState(false);
  const [quickEditToken, setQuickEditToken] = useState<Token | null>(null);
  // UI selection for the tray — not socket/live table state.
  const [focusedTokenId, setFocusedTokenId] = useState<string | null>(null);
  const [playerPreview, setPlayerPreview] = useState(false);

  const isWide = useWideViewport();
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [partyDrawerOpen, setPartyDrawerOpen] = useState(false);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [sessionRequestedTab, setSessionRequestedTab] = useState<SessionRailTab | null>(null);
  const [sessionTabRequestKey, setSessionTabRequestKey] = useState(0);

  const openPartyDrawer = () => {
    setSessionDrawerOpen(false);
    setPartyDrawerOpen(true);
  };
  const openSessionDrawer = (tab?: SessionRailTab) => {
    setPartyDrawerOpen(false);
    if (tab) {
      setSessionRequestedTab(tab);
      setSessionTabRequestKey((key) => key + 1);
    }
    setSessionDrawerOpen(true);
  };

  useEffect(() => {
    if (!isWide) return;
    setPartyDrawerOpen(false);
    setSessionDrawerOpen(false);
  }, [isWide]);

  useEffect(() => {
    setFocusedTokenId(null);
  }, [campaign?.id, currentMap?.id]);

  // SessionToolbar reports which tool was clicked; the open/close state
  // for each slide-over stays here.
  const sessionPanelOpeners: Record<SessionToolKey, () => void> = {
    maps: () => setIsMapManagerOpen(true),
    tokens: () => setIsTokenManagerOpen(true),
    creatures: () => setIsCreatureLibraryOpen(true),
    templates: () => setIsTokenTemplateLibraryOpen(true),
    spirit: () => setIsSpiritLayerOpen(true),
    atmosphere: () => setIsAtmospherePanelOpen(true),
    settings: () => setIsSettingsOpen(true),
  };

  // ============================================
  // Session WebSocket listeners
  // All clients (DM + Players) listen so campaign status stays in sync
  // ============================================
  useEffect(() => {
    // Register on the live socket only once it is actually connected. The socket
    // wrapper is a stable singleton whose underlying connection is created
    // asynchronously, so registering before the connection exists would silently
    // no-op. Re-running when `status` flips to 'connected' — including after a
    // reconnect that recreates the socket — (re)registers on the live socket.
    if (!socket || status !== 'connected') return;

    const handleStarted = (data: { sessionId: string; sessionNumber: number; startedAt: string }) => {
      updateCampaignStatus(CampaignStatus.ACTIVE);
      setActiveSession({ id: data.sessionId, sessionNumber: data.sessionNumber, startedAt: data.startedAt });
    };
    const handlePaused = () => {
      updateCampaignStatus(CampaignStatus.PAUSED);
    };
    const handleEnded = () => {
      updateCampaignStatus(CampaignStatus.INACTIVE);
      setActiveSession(null);
    };
    const handleResumed = (data: { sessionId: string; sessionNumber: number; startedAt: string }) => {
      updateCampaignStatus(CampaignStatus.ACTIVE);
      setActiveSession({ id: data.sessionId, sessionNumber: data.sessionNumber, startedAt: data.startedAt });
    };

    socket.onSessionStarted(handleStarted);
    socket.onSessionPaused(handlePaused);
    socket.onSessionEnded(handleEnded);
    socket.onSessionResumed(handleResumed);

    return () => {
      // Through the client, not the raw io instance. The client keeps a registry
      // so listeners survive a reconnect, and `getSocket().off()` only detaches
      // from the current instance — the registry entry would survive and be
      // re-attached on the next reconnect, stacking up four more stale handlers
      // every time this effect re-ran.
      socket.off('session.started', handleStarted);
      socket.off('session.paused', handlePaused);
      socket.off('session.ended', handleEnded);
      socket.off('session.resumed', handleResumed);
    };
  }, [socket, status, updateCampaignStatus, setActiveSession]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-soft-cream via-parchment to-warm-amber/20">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-brand-ink animate-spin mx-auto" />
          <p className="text-stone-gray">Loading campaign...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-soft-cream via-parchment to-warm-amber/20">
        <div className="card-cozy max-w-md text-center space-y-4">
          <p className="text-spirit-red font-medium">{error}</p>
          <Button onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="w-4 h-4 inline mr-2" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // No campaign loaded
  if (!campaign) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-soft-cream via-parchment to-warm-amber/20">
        <div className="card-cozy max-w-md text-center space-y-4">
          <p className="text-stone-gray">Campaign not found</p>
          <Button onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="w-4 h-4 inline mr-2" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gradient-to-br from-soft-cream via-parchment to-warm-amber/20">
      {/* Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-moss-green/10 border-b border-moss-green/20 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            onClick={() => navigate('/dashboard')}
            variant="secondary" className="flex items-center gap-2"
            aria-label="Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </Button>

          <div className="h-6 w-px bg-moss-green/20" />

          <h1 className="min-w-0 truncate text-xl font-bold text-brand-ink">
            {campaign.name}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Connection Status */}
          <ConnectionStatus />

          {/* Session status indicator (visible to all) */}
          {campaign.status === CampaignStatus.ACTIVE && (
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-success/10 border border-success/20"
              aria-label="Live"
            >
              <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="text-xs font-medium text-success-ink sr-only sm:not-sr-only">Live</span>
            </div>
          )}
          {campaign.status === CampaignStatus.PAUSED && (
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-warm-amber/10 border border-warm-amber/20"
              aria-label="Paused"
            >
              <PauseCircle className="w-3.5 h-3.5 text-warm-amber" />
              <span className="text-xs font-medium text-warm-amber sr-only sm:not-sr-only">Paused</span>
            </div>
          )}
          {campaign.status === CampaignStatus.INACTIVE && (
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-stone-gray/10 border border-stone-gray/20"
              aria-label="Inactive"
            >
              <div className="w-2 h-2 rounded-full bg-stone-gray/50" />
              <span className="text-xs font-medium text-stone-gray sr-only sm:not-sr-only">Inactive</span>
            </div>
          )}

          {/* Vibe indicator (visible to all) */}
          {campaign?.currentVibe && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-warm-amber/10 border border-warm-amber/20">
              <Sun className="w-3.5 h-3.5 text-warm-amber" />
              <span className="text-xs font-medium text-warm-amber capitalize hidden sm:inline">
                {campaign.currentVibe}
              </span>
            </div>
          )}

          {/* DM tools — grouped icon toolbar on wide; labelled menu on narrow
              so Map Library / tokens / creatures / settings are not clipped. */}
          {userRole === 'DM' && (
            <>
              <div className="h-6 w-px bg-moss-green/20" />
              <DmToolsMenu
                isWide={isWide}
                openPanels={{
                  maps: isMapManagerOpen,
                  tokens: isTokenManagerOpen,
                  creatures: isCreatureLibraryOpen,
                  templates: isTokenTemplateLibraryOpen,
                  spirit: isSpiritLayerOpen,
                  atmosphere: isAtmospherePanelOpen,
                  settings: isSettingsOpen,
                }}
                onOpen={(key) => sessionPanelOpeners[key]()}
                spiritLayerEnabled={campaign?.spiritLayerEnabled}
                dismissed={partyDrawerOpen || sessionDrawerOpen}
                onWillOpen={() => {
                  setPartyDrawerOpen(false);
                  setSessionDrawerOpen(false);
                }}
              />
            </>
          )}

          {/* An owner who has handed the game over keeps two powers — deleting
              the campaign and taking the seat back — and this is their way to
              them. It sits here, beside where the DM's own settings gear would
              be, because that is where somebody goes looking for it; tucked in
              the sidebar it read as missing. */}
          {isOwner && userRole !== 'DM' && (
            <>
              <div className="h-6 w-px bg-moss-green/20" />
              <Tooltip content="Owner settings — delete, or take back the DM role" side="bottom">
                <Button
                  variant="ghost"
                  iconOnly
                  icon={Settings}
                  aria-label="Owner Settings"
                  onClick={() => setIsSettingsOpen(true)}
                />
              </Tooltip>
            </>
          )}

          {/* Documents shared with the campaign. Every member, not just the
              DM: a rulebook the table is meant to read has to be reachable by
              the people reading it. */}
          <div className="h-6 w-px bg-moss-green/20" />
          <Tooltip content="Campaign documents" side="bottom">
            <Button
              variant="ghost"
              iconOnly
              icon={BookOpen}
              aria-label="Campaign documents"
              onClick={() => setIsDocumentsOpen(true)}
            />
          </Tooltip>

          {/* Sidebar collapse toggles — wide rails only. Narrow uses drawers. */}
          {isWide && (
            <>
              <div className="h-6 w-px bg-moss-green/20" />
              <div className="flex items-center gap-1">
                <Tooltip content={leftCollapsed ? 'Show party panel' : 'Hide party panel'} side="bottom">
                  <Button
                    variant="ghost"
                    iconOnly
                    icon={leftCollapsed ? PanelLeftOpen : PanelLeftClose}
                    aria-label={leftCollapsed ? 'Show party panel' : 'Hide party panel'}
                    onClick={() => setLeftCollapsed((value) => !value)}
                  />
                </Tooltip>
                <Tooltip content={rightCollapsed ? 'Show session panel' : 'Hide session panel'} side="bottom">
                  <Button
                    variant="ghost"
                    iconOnly
                    icon={rightCollapsed ? PanelRightOpen : PanelRightClose}
                    aria-label={rightCollapsed ? 'Show session panel' : 'Hide session panel'}
                    onClick={() => setRightCollapsed((value) => !value)}
                  />
                </Tooltip>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Session Paused Banner — visible to players when session is paused */}
      {campaign.status === CampaignStatus.PAUSED && userRole !== 'DM' && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-warm-amber/10 border-b border-warm-amber/20">
          <PauseCircle className="w-4 h-4 text-warm-amber flex-shrink-0" />
          <p className="text-xs font-medium text-warm-amber">
            Session is paused. Token movement is disabled, and your dice rolls stay on your own screen.
          </p>
        </div>
      )}

      {/* Focus table. Party and Session stay mounted at every width so roster
          socket listeners and chat history survive the breakpoint and drawers. */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="relative flex h-full w-full min-h-0">
          <TableDrawer
            id="party-drawer"
            title="Party"
            side="left"
            isWide={isWide}
            collapsed={leftCollapsed}
            open={partyDrawerOpen}
            onClose={() => setPartyDrawerOpen(false)}
          >
            <CampaignInfo />
            <CampaignRoster />
            {userRole === 'DM' && (
              <TokenRoster onEditToken={setQuickEditToken} />
            )}
          </TableDrawer>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <CurrentTurnBar playerPreview={playerPreview} />
            <section className="min-h-0 min-w-0 flex-1 p-2 sm:p-4">
              <Suspense
                fallback={
                  <div className="w-full h-full flex items-center justify-center" aria-live="polite" aria-label="Loading map">
                    <Loader2 className="w-8 h-8 text-brand-ink animate-spin" aria-hidden="true" />
                  </div>
                }
              >
                <MapCanvas
                  onEditToken={setQuickEditToken}
                  focusedTokenId={focusedTokenId}
                  onFocusToken={setFocusedTokenId}
                  onPlayerPreviewChange={setPlayerPreview}
                />
              </Suspense>
            </section>
            <ContextualTray
              focusedTokenId={focusedTokenId}
              isWide={isWide}
              playerPreview={playerPreview}
              onFocusToken={setFocusedTokenId}
              onEditToken={setQuickEditToken}
              onOpenParty={openPartyDrawer}
              onOpenSession={() => openSessionDrawer()}
              onOpenInitiative={() => openSessionDrawer('initiative')}
              partyOpen={partyDrawerOpen}
              sessionOpen={sessionDrawerOpen}
            />
          </div>

          <TableDrawer
            id="session-drawer"
            title="Session"
            side="right"
            isWide={isWide}
            collapsed={rightCollapsed}
            open={sessionDrawerOpen}
            onClose={() => setSessionDrawerOpen(false)}
            scrollBody={false}
          >
            <SessionSidebar
              requestedTab={sessionRequestedTab}
              requestKey={sessionTabRequestKey}
            />
          </TableDrawer>
        </div>
      </main>

      {/* Map Manager slide-over panel (DM only) */}
      {userRole === 'DM' && (
        <MapManager
          isOpen={isMapManagerOpen}
          onClose={() => setIsMapManagerOpen(false)}
        />
      )}

      {/* Token Manager slide-over panel (DM only) */}
      {userRole === 'DM' && (
        <TokenManager
          isOpen={isTokenManagerOpen}
          onClose={() => setIsTokenManagerOpen(false)}
        />
      )}

      {/* Spirit Layer Controls slide-over panel (DM only) */}
      {userRole === 'DM' && (
        <SpiritLayerControls
          isOpen={isSpiritLayerOpen}
          onClose={() => setIsSpiritLayerOpen(false)}
        />
      )}

      {/* Atmosphere Panel slide-over (DM only) */}
      {userRole === 'DM' && (
        <AtmospherePanel
          isOpen={isAtmospherePanelOpen}
          onClose={() => setIsAtmospherePanelOpen(false)}
        />
      )}

      {/* Creature Library slide-over (DM only) */}
      {userRole === 'DM' && (
        <CreatureLibrary
          isOpen={isCreatureLibraryOpen}
          onClose={() => setIsCreatureLibraryOpen(false)}
        />
      )}

      {/* Token Template Library slide-over (DM only) */}
      {userRole === 'DM' && (
        <TokenTemplateLibrary
          isOpen={isTokenTemplateLibraryOpen}
          onClose={() => setIsTokenTemplateLibraryOpen(false)}
        />
      )}

      {/* NPC Quick Editor — DM only */}
      {userRole === 'DM' && quickEditToken && campaign && currentMap && (
        <NpcQuickEditor
          token={quickEditToken}
          campaignId={campaign.id}
          mapId={currentMap.id}
          onClose={() => setQuickEditToken(null)}
          onTokenUpdate={(updated) => {
            // A stat block saves when the editor closes, so its answer often
            // arrives after the DM closed the editor or opened another token.
            // Update the editor only while it still shows this token.
            setQuickEditToken((open) => (open?.id === updated.id ? updated : open));
            useGameStore.getState().replaceToken(updated);
          }}
        />
      )}

      {/* Campaign Settings slide-over panel — the DM, or the owner, who sees
          only the parts that are theirs (see CampaignSettingsModal). */}
      {canOpenSettings && (
        <CampaignSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {campaign?.id && (
        <CampaignDocumentsModal
          isOpen={isDocumentsOpen}
          onClose={() => setIsDocumentsOpen(false)}
          campaignId={campaign.id}
          isDM={userRole === 'DM'}
        />
      )}

      {/* Atmosphere Player — mounts for ALL users, manages ambient audio sync */}
      <AtmospherePlayer />
    </div>
  );
}

// ============================================
// Campaign Page (with provider wrapper)
// ============================================

export default function CampaignPage() {
  return (
    <CampaignProvider>
      <WebSocketProvider>
        <CampaignPageContent />
      </WebSocketProvider>
    </CampaignProvider>
  );
}
