// ============================================
// Campaign Context
// Manages campaign state and data
// ============================================

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import { useParams } from 'react-router';
import campaignService from '@/services/campaign.service';
import api from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useGameStore } from '@/stores/gameStore';
import type { Campaign, CampaignMembership, CampaignRole, CampaignStatus, Map, VibeSettings, VibePeriod, CharacterHpUpdatedBroadcast, DmTransferredBroadcast, MemberRoleChangedBroadcast } from '@/types';
import { TokenLayer } from '@/types';
import type { CharacterHpInfo } from '@/utils/characterHp';
import socketClient from '@/services/socket';
import { apiErrorMessage, apiErrorStatus } from '@/utils/errors';
import { withMemberRole } from '@/utils/campaignRoles';

// ============================================
// Types
// ============================================

/**
 * Settled result of Retry map load / Retry sync. Success uses a fixed
 * phrase; failure returns the string just stored on the matching error.
 * A discarded reply (stale generation, live map switch, or overlapping map
 * read) is distinct and must not be announced. Pause/end/resume/start and
 * another member's role change do not discard an in-flight map hydrate.
 * This user's own role change rejects the body and surfaces Retry.
 */
export type TableRetryOutcome =
  | { ok: true; message: string }
  | { ok: false; message: string }
  | { discarded: true };

const MAP_LOADED_MESSAGE = 'Map loaded';
const TABLE_SYNCED_MESSAGE = 'Table synced';
const MAP_LOAD_FALLBACK = 'Failed to load map';
const CATCH_UP_FALLBACK = 'Failed to catch up after reconnect';
const MAP_REFRESH_FALLBACK = 'Failed to refresh the current map';

// NOTE: live token state moved out of this context into the
// zustand game store (`@/stores/gameStore`). Context value changes
// re-render EVERY useCampaign() consumer, so the high-frequency token
// stream must not flow through here — subscribe with useTokenList() /
// useTokenListIgnoringMovement() and mutate via store actions instead.
interface CampaignContextState {
  // Campaign Data
  campaign: Campaign | null;
  currentMap: Map | null;
  /**
   * Bumped when demotion rewrites on-screen wall/light geometry (locked
   * doors stripped, then the player-filtered hydrate including lights).
   * MapCanvas reloads the live wall editor on map id change or this
   * generation, not on every same-map snapshot.
   */
  mapGeometryGen: number;

  // User Role
  userRole: CampaignRole | null;

  // Loading & Error States
  loading: boolean;
  error: string | null;
  /**
   * Campaign-row GET failed with something other than 403/404. Retry reloads
   * the campaign; 403/404 stay on the error until Back to Dashboard and are
   * not retryable.
   */
  errorRetryable: boolean;
  /**
   * First `getMap` after the campaign row loaded failed. The table chrome
   * stays; Retry refetches this map only. Null when there is no current map
   * or that map loaded.
   */
  mapLoadError: { mapId: string; message: string } | null;
  /**
   * Catch-up or current-map refresh failed while the table is visible.
   * The last frame stays; Retry re-runs catch-up.
   */
  syncError: string | null;

  // Actions
  loadCampaign: (id: string) => Promise<void>;
  /**
   * Patch roster/settings fields on the campaign REST document in Context
   * (name, description, chat settings, memberships, characters, maps,
   * owner, game system). A settings PUT document does not copy live table
   * fields: status, currentMapId, vibe, and spirit stay on the socket. A
   * GET that is still the current campaign-row read also copies status and
   * activeSession when statusEpoch is unchanged (same contract as catch-up
   * and roster.updated). Does not set `loading`. A settings PUT document
   * does not rewrite tokens; a current-row GET catch-up hydrates the table
   * map, including when that id is already on screen. Given a
   * document (the body a settings PUT already returned), apply it; otherwise
   * GET the row and apply that. A settings PUT should pass the seq from
   * `beginSettingsWrite` (taken before the HTTP await) so an earlier write
   * cannot rewind a later one. Omitting the seq takes one at apply for
   * callers that have not begun the write. Returns whether that PUT's
   * settings were applied; a skipped older document is false. GET returns
   * true when the row was applied.
   */
  refreshCampaign: (document?: Campaign, settingsWriteSeq?: number) => Promise<boolean>;
  /**
   * Assign a write identity seq without advancing the applied settings
   * generation. Call before a settings PUT HTTP request; pass the seq to
   * `refreshCampaign(document, seq)` when that PUT returns.
   */
  beginSettingsWrite: () => number;
  /**
   * Refetch the map named by `mapLoadError` without remounting the campaign.
   * Resolves `{ ok: true, message: 'Map loaded' }` when a hydrate is applied;
   * `{ ok: false, message }` on failure (the string just stored on
   * `mapLoadError`); `{ discarded: true }` when the reply is stale (no new
   * toast, no fallback phrase). Does not bump `loadGeneration`.
   */
  retryMapLoad: () => Promise<TableRetryOutcome>;
  /**
   * Re-fetch ONLY the current map (tokens, walls, lights, fog) without
   * reloading the whole campaign envelope. Used after a WebSocket reconnect
   * to pick up state changes that broadcast while we were disconnected
   * (e.g. token positions moved by other players during the drop).
   */
  refreshCurrentMap: () => Promise<void>;
  /**
   * After a reconnect: re-read what arrives only as events (the session's
   * state, members' roles, the map the table is on) and reload that map.
   * Resolves `{ ok: true, message: 'Table synced' }` when a hydrate is applied
   * or catch-up otherwise succeeds; `{ ok: false, message }` on failure (the
   * string just stored on `syncError`); `{ discarded: true }` when the reply
   * is stale (no new toast, no fallback phrase).
   */
  catchUpAfterReconnect: () => Promise<TableRetryOutcome>;
  /**
   * Switch to a map, or clear it. Given a function, changes the map already
   * showing from its latest value, as a listener registered once must: a
   * map it captured earlier may have been edited since. The function form
   * never switches maps.
   */
  setCurrentMap: (map: Map | null | ((current: Map | null) => Map | null)) => void;
  /**
   * Keep `campaign.maps` in step with the Map Library: insert a created or
   * imported map, or replace a renamed one by id. The Move to Map… submenu
   * reads that list, so a map missing from it cannot be a move target.
   */
  upsertCampaignMap: (map: Map) => void;
  /** Drop a deleted map from `campaign.maps`. */
  removeCampaignMap: (mapId: string) => void;
  /** Update spirit layer enabled/style in local campaign state (after WS broadcast or API call) */
  updateCampaignSpiritLayer: (enabled: boolean, style?: string) => void;
  /** DM-only local preference: show both planes simultaneously or only the active one */
  dmViewBothPlanes: boolean;
  setDmViewBothPlanes: (val: boolean) => void;
  /** Whether this player personally has spirit layer visibility (individual crossover, not global toggle) */
  playerSpiritVisible: boolean;
  setPlayerSpiritVisible: (val: boolean) => void;
  /** Current active vibe period name (e.g. 'dawn', 'night') */
  currentVibe: string | null;
  /** Cached hue + CSS filter for the current vibe — used by MapCanvas for the overlay */
  activeVibeEffect: { hue: string; filter: string } | null;
  /** Called when vibe.updated WebSocket arrives — updates currentVibe + activeVibeEffect */
  updateVibe: (period: string, hue: string, filter: string) => void;
  /** Called after saving ConfigureVibeModal — patches campaign.vibeSettings in local state */
  updateVibeSettings: (settings: VibeSettings) => void;
  /** Current open session (id, sessionNumber, startedAt) — null when no active session */
  activeSession: { id: string; sessionNumber: number; startedAt: string } | null;
  /** Set active session — called by SessionControls after start/resume REST response */
  setActiveSession: (session: { id: string; sessionNumber: number; startedAt: string } | null) => void;
  /** Update campaign.status in local state — called by session WebSocket listeners */
  updateCampaignStatus: (status: CampaignStatus) => void;
  /** Active particle effect name ('rain' | 'mist' | 'leaves' | 'sparkles' | 'snow' | null) */
  activeAtmosphereEffect: string | null;
  /** Update atmosphere effect — called by AtmospherePlayer on WS broadcast */
  updateAtmosphereEffect: (effect: string | null) => void;
  /** Active ambient audio (assetId, audioUrl, volume, loop) or null when stopped */
  activeAtmosphereAudio: { assetId: string; audioUrl: string; volume: number; loop: boolean } | null;
  /** Update atmosphere audio — called by AtmospherePlayer on WS broadcast */
  updateAtmosphereAudio: (audio: { assetId: string; audioUrl: string; volume: number; loop: boolean } | null) => void;
  /** Cache of character HP keyed by characterId — populated from roster, updated by character.hp.updated WS events */
  characterHpCache: Record<string, CharacterHpInfo>;
  /** Seed the HP cache from roster data (called by CampaignRoster after fetch) */
  seedCharacterHpCache: (entries: { id: string; hp: CharacterHpInfo | null }[]) => void;
}

// ============================================
// Context Creation
// ============================================

const CampaignContext = createContext<CampaignContextState | undefined>(
  undefined
);

// ============================================
// Provider Component
// ============================================

interface CampaignProviderProps {
  children: ReactNode;
}

/**
 * The atmosphere fields this context reads out of a campaign's `vibeSettings`
 * blob. Declared locally rather than as `Record<string, any>` so each optional
 * hop is checked — the reads below already guard with `??`, and the type now
 * says so.
 */
interface VibeSettingsBlob {
  atmosphereEffect?: string | null;
  atmosphereAudio?: {
    assetId?: string;
    volume?: number;
    loop?: boolean;
  };
}

export function CampaignProvider({ children }: CampaignProviderProps) {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  // The campaign the page shows now, for work that finishes after an await.
  // None once the page closes: the next campaign's page reads the same token
  // store, and a late answer for this one would write over it.
  //
  // Not derived only from `campaign?.id`: that is null during the first load,
  // so a reply tagged with the route / requested id would be dropped. Set at
  // the start of `loadCampaign`. Generation is the other half of the guard.
  const shownCampaignId = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const currentMapIdRef = useRef<string | null>(null);
  // Live map-id switches (including a clear) go through setCurrentMap.
  // REST hydrates do not bump this: a stale GET must not override a later
  // live switch, including A→B→A which leaves the showing id unchanged.
  const mapEpoch = useRef(0);
  // Role/membership clock: this user's own role change, another member's
  // role change, and a DM transfer this user is not a party to. Independent
  // of mapEpoch. Pause/resume/end/start do not bump this. Campaign-row GETs
  // copy memberships only while this is unchanged. Map hydrates snapshot
  // this user's own role instead: pause/end/resume/start and another
  // member's role change must not abort an in-flight getMap.
  const sessionEpoch = useRef(0);
  // Status/session clock: pause, resume, end, start. Campaign-row GETs copy
  // status and activeSession only while this is unchanged, even if a role
  // event landed during the GET. A live pause/end/resume during GET keeps
  // the live status rather than rewinding to the snapshot.
  const statusEpoch = useRef(0);
  // Local Map Library insert/rename/delete. A refreshCampaign GET copies
  // maps only while this is unchanged and this user's role is still the
  // role captured when that GET started.
  const mapListGen = useRef(0);
  // Settings PUT write-identity sequence. Incremented by beginSettingsWrite
  // (and at apply when a caller omitted the seq). Does not move the applied
  // clock: a failed later PUT must not stale an earlier success.
  const settingsWriteStart = useRef(0);
  // Last applied settings-write seq. A GET copies name/description/chat/
  // ownerId/gameSystem only while this is unchanged since that GET started.
  const settingsGen = useRef(0);
  // Overlapping map REST reads (load, refresh, retry, catch-up) and empty-map
  // clears. Independent of loadGeneration (campaign switch / unmount) and
  // mapEpoch (live id switches). A hydrate or clear applies only while this
  // read's sequence is still the latest.
  const mapReadSeq = useRef(0);
  // Overlapping campaign-row GETs: catch-up, roster.updated, and
  // refreshCampaign. An older memberships/characters/status body must not
  // overwrite a newer one, and a stale 403/404 or syncError must not land
  // after a newer row has already been applied.
  const campaignRowSeq = useRef(0);
  // In-flight getMap reads (load, refresh, retry, catch-up). Demotion strips
  // spirit immediately and starts a player getMap of the map on screen even
  // when a DM read is already in flight, so the new read is the latest
  // mapReadSeq and the DM body cannot apply.
  const mapReadsInFlight = useRef(0);
  const refreshCurrentMapRef = useRef<(opts?: { playerDemotion?: boolean }) => Promise<void>>(async () => {});
  // This user's latest own role for the campaign the page is showing, even
  // while `campaign` is still null (first load). Demotion during getCampaign
  // would otherwise be dropped because handleRoleChanged / authenticated
  // return immediately when there is no row.
  const liveRoleRef = useRef<CampaignRole | null>(null);
  // Latest live status for the shown campaign, even while `campaign` is null
  // (first load). A pause heard during getCampaign would otherwise be
  // overwritten by the GET body.
  const liveStatusRef = useRef<CampaignStatus | null>(null);
  // Live session writes (start/resume object, or null for session.ended)
  // during a hung GET. Distinct from "never written" so an ended session
  // is not replaced by the GET's activeSession.
  const liveSessionWrittenRef = useRef(false);
  const liveSessionRef = useRef<{ id: string; sessionNumber: number; startedAt: string } | null>(null);
  // Catch-up or a winning roster/refresh GET accepted a different
  // currentMapId (or an empty clear) and bumped mapReadSeq; hydrate/clear
  // is still in flight. refreshCurrentMap / retryMapLoad of a different id
  // must not steal that sequence.
  const claimedMapRef = useRef<{ id: string | null; seq: number } | null>(null);
  const bumpGeneration = () => {
    loadGeneration.current += 1;
    return loadGeneration.current;
  };
  const bumpMapReadSeq = () => {
    mapReadSeq.current += 1;
    return mapReadSeq.current;
  };
  const bumpCampaignRowSeq = () => {
    campaignRowSeq.current += 1;
    return campaignRowSeq.current;
  };
  const nextSettingsWriteSeq = () => {
    settingsWriteStart.current += 1;
    return settingsWriteStart.current;
  };
  const beginSettingsWrite = useCallback((): number => nextSettingsWriteSeq(), []);
  const ownRoleOn = (memberships: Campaign['memberships']): CampaignRole | undefined => {
    const ownId = userIdRef.current;
    return ownId ? memberships?.find((m) => m.userId === ownId)?.role : undefined;
  };
  const isNonDmRole = (role: CampaignRole | null | undefined) =>
    role === 'PLAYER' || role === 'SPECTATOR';
  /**
   * This user just left the DM seat. Drop spirit-plane UI, maps a player
   * cannot read, hidden tokens, Keeper notes/stat blocks, and door locks
   * until a player-filtered GET/getMap replaces the rest (lights, etc.).
   */
  const stripDemotedDmSpirit = () => {
    setPlayerSpiritVisible(false);
    const tokens = Object.values(useGameStore.getState().tokens);
    useGameStore.getState().setTokens(
      tokens
        .filter((t) => t.layer !== TokenLayer.SPIRIT && t.visible !== false)
        .map((t) => ({ ...t, notes: '', statBlock: null })),
    );
    setCurrentMapState((prev) => {
      if (!prev) return prev;
      const walls = prev.wallSegments;
      const hadLockedDoor = walls?.some((w) => w.type === 'door-locked') ?? false;
      const nextWalls = hadLockedDoor && walls
        ? walls.map((w) => (w.type === 'door-locked' ? { ...w, type: 'door-closed' as const } : w))
        : walls;
      const nextTokens = prev.tokens
        ?.filter((t) => t.layer !== TokenLayer.SPIRIT && t.visible !== false)
        .map((t) => ({ ...t, notes: '', statBlock: null }));
      const spiritChanged = Boolean(prev.spiritLayerUrl);
      if (!hadLockedDoor && !spiritChanged && nextTokens === prev.tokens) return prev;
      return {
        ...prev,
        spiritLayerUrl: spiritChanged ? null : prev.spiritLayerUrl,
        wallSegments: nextWalls,
        tokens: nextTokens ?? prev.tokens,
      };
    });
    const tableMapId = currentMapIdRef.current;
    setCampaign((prev) => {
      if (!prev?.maps) return prev;
      const nextMaps = prev.maps
        .filter((m) => m.id === tableMapId)
        .map((m) => (m.spiritLayerUrl ? { ...m, spiritLayerUrl: null } : m));
      return { ...prev, maps: nextMaps };
    });
    setMapGeometryGen((n) => n + 1);
  };
  const leftDmSeat = (previous: CampaignRole | null, next: CampaignRole) =>
    previous === 'DM' && isNonDmRole(next);
  /**
   * Record this user's own role for the shown campaign. Same role is not a
   * live update. Reconnect `authenticated` with the role we already have
   * must not bump, or catch-up would skip memberships that arrived only as
   * GET. The first record (ref was empty) is not a change either: the
   * socket often authenticates while the first getCampaign is still in
   * flight, and bumping then would treat a matching GET as stale.
   */
  const noteOwnLiveRole = (campaignId: string, role: CampaignRole): boolean => {
    if (shownCampaignId.current !== campaignId) return false;
    if (liveRoleRef.current === role) return false;
    const hadRole = liveRoleRef.current !== null;
    const previous = liveRoleRef.current;
    liveRoleRef.current = role;
    if (hadRole && leftDmSeat(previous, role)) {
      stripDemotedDmSpirit();
      if (currentMapIdRef.current) {
        void refreshCurrentMapRef.current({ playerDemotion: true });
      }
    }
    if (!hadRole) return false;
    sessionEpoch.current += 1;
    return true;
  };
  /**
   * Adopt this user's role from a campaign-row GET that is applying
   * memberships (role clock unchanged). Direct assign: do not call
   * noteOwnLiveRole, which would bump the role clock and keep the old
   * DM memberships. In-flight map hydrates snapshot liveRoleRef, so this
   * must land before keepMaps on refreshCampaign and before a hung getMap
   * is judged. Strip spirit when this GET itself moves the live role off DM.
   * Returns true when this GET left the DM seat; callers then refetch the
   * map on screen as the new role (or hydrate a different currentMapId).
   */
  const adoptOwnRoleFromGet = (memberships: Campaign['memberships']): boolean => {
    const own = ownRoleOn(memberships);
    if (!own) return false;
    const previous = liveRoleRef.current;
    liveRoleRef.current = own;
    if (leftDmSeat(previous, own)) {
      stripDemotedDmSpirit();
      return true;
    }
    return false;
  };
  /**
   * A current-row GET copies maps when this user's role on that body matches
   * liveRoleRef (a PLAYER GET replaces the DM list). A body that still names
   * this user as DM while live role is not DM is not applied; the stored list
   * was already stripped. Local mapListGen still wins over a hung GET while
   * this user remains DM. After demotion the filtered GET / strip wins.
   */
  const keepGetMaps = (fresh: Campaign, mapListMoved: boolean) => {
    const ownFromGet = ownRoleOn(fresh.memberships);
    const liveRole = liveRoleRef.current;
    if (ownFromGet != null && ownFromGet === liveRole) {
      return mapListMoved && liveRole === 'DM';
    }
    return true;
  };
  const withMapRead = async <T,>(fn: () => Promise<T>): Promise<T> => {
    mapReadsInFlight.current += 1;
    try {
      return await fn();
    } finally {
      mapReadsInFlight.current -= 1;
    }
  };
  const membershipWithRole = (
    data: Campaign,
    userId: string,
    role: CampaignRole,
  ): CampaignMembership => {
    const existing = data.memberships?.find((m) => m.userId === userId);
    return existing
      ? { ...existing, role }
      : {
          id: userId,
          userId,
          campaignId: data.id,
          role,
          characterIds: [],
          joinedAt: data.createdAt,
        };
  };
  const replyIsCurrent = (campaignId: string, generation: number) =>
    generation === loadGeneration.current && shownCampaignId.current === campaignId;
  const [currentMap, setCurrentMapState] = useState<Map | null>(null);
  currentMapIdRef.current = currentMap?.id ?? null;
  const [mapGeometryGen, setMapGeometryGen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorRetryable, setErrorRetryable] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<{ mapId: string; message: string } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  // DM local view preference — not persisted, resets each session
  const [dmViewBothPlanes, setDmViewBothPlanes] = useState(true);
  // Per-player spirit visibility — set from REST on load, updated by WebSocket events
  const [playerSpiritVisible, setPlayerSpiritVisible] = useState(false);
  // Vibe tracker — cached visual effect for the current period
  const [activeVibeEffect, setActiveVibeEffect] = useState<{ hue: string; filter: string } | null>(null);
  // Current open session (for SessionControls)
  const [activeSession, setActiveSessionState] = useState<{ id: string; sessionNumber: number; startedAt: string } | null>(null);
  // Atmosphere state — effect + audio
  const [activeAtmosphereEffect, setActiveAtmosphereEffect] = useState<string | null>(null);
  const [activeAtmosphereAudio, setActiveAtmosphereAudio] = useState<{ assetId: string; audioUrl: string; volume: number; loop: boolean } | null>(null);
  // Character HP cache — keyed by characterId, updated by WS event and roster seed
  const [characterHpCache, setCharacterHpCache] = useState<Record<string, CharacterHpInfo>>({});

  /**
   * Count a live map-id change (including a clear). Same-id patches — fog,
   * illumination, rename — must not bump. REST hydrates call setCurrentMapState
   * directly and do not go through here.
   */
  const adoptLiveMapId = (nextId: string | null) => {
    if (currentMapIdRef.current === nextId) return;
    mapEpoch.current += 1;
    currentMapIdRef.current = nextId;
  };

  /**
   * Adopt a different map id only when no live switch happened since this
   * read started. If the epoch moved, same-map hydrate of the id now on
   * screen may still apply; do not switch to a different id and do not clear.
   */
  const mayApplyFetchedMap = (fetchedMapId: string, epochWhenStarted: number) => {
    if (mapEpoch.current === epochWhenStarted) return true;
    return currentMapIdRef.current === fetchedMapId;
  };

  const ownRoleMoved = (whenStarted: CampaignRole | null) =>
    liveRoleRef.current !== whenStarted;

  /**
   * This map GET may apply: latest read, this user's own role is unchanged
   * (a pause or another member's role does not abort), and the live map
   * id still matches mayApplyFetchedMap.
   */
  const mapReadIsCurrent = (
    seq: number,
    ownRoleWhenStarted: CampaignRole | null,
    fetchedMapId: string,
    mapEpochWhenStarted: number,
  ) =>
    seq === mapReadSeq.current
    && !ownRoleMoved(ownRoleWhenStarted)
    && mayApplyFetchedMap(fetchedMapId, mapEpochWhenStarted);

  /**
   * This user's role changed while a map GET was in flight. The body is
   * filtered for the old role — do not apply it (spirit tokens,
   * spiritLayerUrl). Surface Retry so the table can load the body for the
   * new role. Returns true when this was the reason the hydrate was dropped.
   */
  const rejectStaleOwnRoleHydrate = (
    seq: number,
    ownRoleWhenStarted: CampaignRole | null,
    mapId: string,
    mapEpochWhenStarted: number,
    kind: 'mapLoad' | 'sync',
  ): boolean => {
    if (seq !== mapReadSeq.current) return false;
    if (!mayApplyFetchedMap(mapId, mapEpochWhenStarted)) return false;
    if (!ownRoleMoved(ownRoleWhenStarted)) return false;
    if (kind === 'mapLoad') {
      setMapLoadError({ mapId, message: MAP_LOAD_FALLBACK });
    } else {
      setSyncError(MAP_REFRESH_FALLBACK);
    }
    return true;
  };

  const hasConflictingMapClaim = (mapId: string) => {
    const claimed = claimedMapRef.current;
    return claimed !== null && claimed.id !== mapId;
  };

  const releaseFetchedMapClaim = (seq: number) => {
    if (claimedMapRef.current?.seq === seq) {
      claimedMapRef.current = null;
    }
  };

  const applyHydratedMap = (
    map: Map,
    spiritVisible?: boolean,
    options?: { playerDemotion?: boolean },
  ) => {
    currentMapIdRef.current = map.id;
    setCurrentMapState(map);
    useGameStore.getState().setTokens(map.tokens || []);
    setPlayerSpiritVisible(spiritVisible ?? false);
    setMapLoadError(null);
    setSyncError(null);
    if (options?.playerDemotion) {
      setMapGeometryGen((n) => n + 1);
    }
  };

  /**
   * Hydrate or clear the table to a campaign-row currentMapId. Catch-up and
   * a winning roster/refresh GET always run this tail, including when the
   * fetched id is already on screen (token catch-up). Different-id claims
   * with mapReadSeq so an in-flight getMap of a different map cannot apply.
   * Same-id token catch-up does not bump mapGeometryGen; a player-filtered
   * demotion hydrate of the same id does.
   */
  const syncTableToFetchedMapId = async (
    campaignId: string,
    mapId: string | null,
    mapEpochWhenStarted: number,
    stillShown: () => boolean,
    options?: { playerDemotion?: boolean },
  ): Promise<TableRetryOutcome> => {
    if (!mapId) {
      if (!stillShown()) return { discarded: true };
      if (mapEpoch.current === mapEpochWhenStarted) {
        const seq = bumpMapReadSeq();
        claimedMapRef.current = { id: null, seq };
        if (seq !== mapReadSeq.current) {
          releaseFetchedMapClaim(seq);
          return { discarded: true };
        }
        currentMapIdRef.current = null;
        setCurrentMapState(null);
        useGameStore.getState().setTokens([]);
        setCampaign((prev) => (prev ? { ...prev, currentMapId: null } : prev));
        setSyncError(null);
        setMapLoadError(null);
        releaseFetchedMapClaim(seq);
        return { ok: true, message: TABLE_SYNCED_MESSAGE };
      }
      return { discarded: true };
    }
    if (!mayApplyFetchedMap(mapId, mapEpochWhenStarted)) {
      return { discarded: true };
    }
    const seq = bumpMapReadSeq();
    const ownRoleWhenStarted = liveRoleRef.current;
    const claimingDifferent = mapId !== currentMapIdRef.current;
    if (claimingDifferent) {
      claimedMapRef.current = { id: mapId, seq };
    }
    try {
      const { map, spiritVisible } = await withMapRead(() => api.getMap(campaignId, mapId));
      if (!stillShown() || map.id !== mapId) {
        return { discarded: true };
      }
      if (!mapReadIsCurrent(seq, ownRoleWhenStarted, map.id, mapEpochWhenStarted)) {
        if (rejectStaleOwnRoleHydrate(seq, ownRoleWhenStarted, mapId, mapEpochWhenStarted, 'sync')) {
          return { ok: false, message: MAP_REFRESH_FALLBACK };
        }
        return { discarded: true };
      }
      applyHydratedMap(map, spiritVisible, {
        playerDemotion: !claimingDifferent && Boolean(options?.playerDemotion),
      });
      setCampaign((prev) =>
        prev && prev.currentMapId !== map.id ? { ...prev, currentMapId: map.id } : prev,
      );
      return { ok: true, message: TABLE_SYNCED_MESSAGE };
    } catch (err) {
      if (!stillShown()) return { discarded: true };
      if (seq !== mapReadSeq.current) return { discarded: true };
      if (!mayApplyFetchedMap(mapId, mapEpochWhenStarted)) return { discarded: true };
      console.error('[CampaignContext] Failed to refresh the current map after reconnect:', err);
      const message = apiErrorMessage(err) || MAP_REFRESH_FALLBACK;
      setSyncError(message);
      return { ok: false, message };
    } finally {
      if (claimingDifferent) releaseFetchedMapClaim(seq);
    }
  };

  /**
   * A winning campaign-row GET (latest campaignRowSeq) hydrates or clears
   * when currentMapId differs from the map on screen, and catch-up getMaps
   * when that id is already showing. A same-id demotion hydrates
   * player-filtered geometry. If this GET demoted and the fetched map was
   * not applied (discarded or failed), still refetch the map on screen as
   * PLAYER.
   */
  const hydrateWinningRowMap = async (
    campaignId: string,
    fetchedMapId: string | null,
    mapEpochWhenStarted: number,
    stillShown: () => boolean,
    demoted: boolean,
  ): Promise<void> => {
    if (fetchedMapId !== currentMapIdRef.current) {
      const outcome = await syncTableToFetchedMapId(
        campaignId,
        fetchedMapId,
        mapEpochWhenStarted,
        stillShown,
      );
      const applied = 'ok' in outcome && outcome.ok === true;
      if (demoted && !applied && stillShown() && currentMapIdRef.current) {
        await refreshCurrentMapRef.current({ playerDemotion: true });
      }
      return;
    }
    await syncTableToFetchedMapId(
      campaignId,
      fetchedMapId,
      mapEpochWhenStarted,
      stillShown,
      { playerDemotion: demoted },
    );
  };

  // Derived: current vibe period name
  const currentVibe = campaign?.currentVibe ?? null;

  // Get user's role in the campaign
  const userRole =
    campaign && user
      ? campaign.memberships?.find((m) => m.userId === user.id)?.role || null
      : null;

  const leaveOnCampaignAccessError = useCallback((err: unknown) => {
    const status = apiErrorStatus(err);
    if (status === 403) {
      setError('You do not have permission to view this campaign');
      setErrorRetryable(false);
      return true;
    }
    if (status === 404) {
      setError('Campaign not found');
      setErrorRetryable(false);
      return true;
    }
    return false;
  }, []);

  // Roster/settings fields only. A settings PUT is a Prisma row, not a live
  // table document: copying status, currentMapId, vibe, or spirit from it
  // would overwrite socket updates that landed while the PUT was in flight.
  // Vibe and spirit stay on the socket; catch-up re-reads status,
  // memberships, and currentMapId (the id only with a live-map hydrate).
  // Maps are optional: a DM GET after demotion must not store another map's
  // spiritLayerUrl; a matching-role GET copies its maps (player-filtered
  // after demotion). A local map-list edit still wins over a hung GET while
  // this user remains DM. keepSettings also holds ownerId and gameSystem
  // when this GET is no longer the latest campaign-row read.
  const applyCampaignDocument = useCallback((
    fresh: Campaign,
    options: {
      keepMemberships?: boolean;
      keepCharacters?: boolean;
      keepMaps?: boolean;
      keepSettings?: boolean;
    } = {},
  ) => {
    const {
      keepMemberships = false,
      keepCharacters = false,
      keepMaps = false,
      keepSettings = false,
    } = options;
    setCampaign((prev) => {
      if (!prev || prev.id !== fresh.id) return prev;
      return {
        ...prev,
        name: keepSettings ? prev.name : fresh.name,
        description: keepSettings ? prev.description : fresh.description,
        chatCooldownEnabled: keepSettings
          ? prev.chatCooldownEnabled
          : (fresh.chatCooldownEnabled ?? prev.chatCooldownEnabled),
        chatCooldownSeconds: keepSettings
          ? prev.chatCooldownSeconds
          : (fresh.chatCooldownSeconds ?? prev.chatCooldownSeconds),
        memberships: keepMemberships ? prev.memberships : (fresh.memberships ?? prev.memberships),
        characters: keepCharacters ? prev.characters : (fresh.characters ?? prev.characters),
        maps: keepMaps ? prev.maps : (fresh.maps ?? prev.maps),
        ownerId: keepSettings ? prev.ownerId : (fresh.ownerId ?? prev.ownerId),
        gameSystem: keepSettings ? prev.gameSystem : (fresh.gameSystem ?? prev.gameSystem),
      };
    });
  }, []);

  // Load campaign data
  const loadCampaign = useCallback(async (campaignId: string) => {
    const generation = bumpGeneration();
    // Reset live role/status/session refs only when the loaded campaign id
    // changes, not on every retry of the same id — a demotion or pause heard
    // during the first GET must still win on a retry of that row.
    if (shownCampaignId.current !== campaignId) {
      liveRoleRef.current = null;
      liveStatusRef.current = null;
      liveSessionWrittenRef.current = false;
      liveSessionRef.current = null;
    }
    claimedMapRef.current = null;
    shownCampaignId.current = campaignId;
    setLoading(true);
    setError(null);
    setErrorRetryable(false);
    setMapLoadError(null);
    setSyncError(null);
    // Drop the previous campaign's row and map so a switch cannot keep the
    // last table on screen, and a failed getMap cannot sit on top of it.
    // REST hydrate: do not bump mapEpoch.
    setCampaign(null);
    currentMapIdRef.current = null;
    setCurrentMapState(null);
    const mapEpochWhenStarted = mapEpoch.current;

    try {
      const data = await campaignService.getCampaign(campaignId);
      if (!replyIsCurrent(campaignId, generation) || data.id !== campaignId) return;
      const ownId = userIdRef.current;
      const liveRole = liveRoleRef.current;
      const ownFromGet = ownId
        ? data.memberships?.find((m) => m.userId === ownId)?.role
        : undefined;
      // A demotion (or promotion) heard while campaign was null is stored on
      // liveRoleRef. The GET may still be the body authorized for the old
      // role — do not keep its memberships or extra maps / spiritLayerUrl,
      // and do not hydrate a map from it.
      const roleMismatch = liveRole != null && ownFromGet !== liveRole;
      // A live pause/end heard while campaign was null is stored on
      // liveStatusRef / liveSessionRef. Prefer those over this GET, but still
      // install the GET maps and roster when this user's role did not change.
      const status = liveStatusRef.current ?? data.status;
      if (roleMismatch) {
        const role = liveRole;
        setCampaign({
          ...data,
          status,
          maps: [],
          memberships: ownId && role ? [membershipWithRole(data, ownId, role)] : [],
        });
      } else {
        setCampaign({
          ...data,
          status,
        });
        if (ownFromGet) liveRoleRef.current = ownFromGet;
      }

      // Initialize active session from campaign response unless a live
      // session write (including session.ended null) arrived during GET.
      setActiveSessionState(
        liveSessionWrittenRef.current
          ? liveSessionRef.current
          : (data.activeSession ?? null),
      );

      // Initialize atmosphere state from saved campaign vibeSettings
      const vs = data.vibeSettings as VibeSettingsBlob | undefined;
      setActiveAtmosphereEffect(vs?.atmosphereEffect ?? null);
      if (vs?.atmosphereAudio?.assetId) {
        setActiveAtmosphereAudio({
          assetId: vs.atmosphereAudio.assetId,
          audioUrl: `/api/assets/audio/${vs.atmosphereAudio.assetId}`,
          volume: vs.atmosphereAudio.volume ?? 0.5,
          loop: vs.atmosphereAudio.loop !== false,
        });
      } else {
        setActiveAtmosphereAudio(null);
      }

      // Initialize vibe effect from saved campaign state
      if (data.currentVibe && data.vibeSettings?.periods) {
        const activePeriod = (data.vibeSettings.periods as VibePeriod[]).find(
          (p) => p.name === data.currentVibe,
        );
        setActiveVibeEffect(
          activePeriod ? { hue: activePeriod.hue, filter: activePeriod.filter } : null,
        );
      } else {
        setActiveVibeEffect(null);
      }

      // Load current map via the filtered REST endpoint so tokens are spirit-filtered
      // per this user's role. The campaign response (maps: true) returns raw unfiltered
      // token JSON — we must NOT use those tokens directly.
      // A GET body authorized for the previous role must not hydrate or clear.
      if (!roleMismatch && data.currentMapId) {
        const requestedMapId = data.currentMapId;
        const seq = bumpMapReadSeq();
        const ownRoleWhenStarted = liveRoleRef.current;
        try {
          const { map, spiritVisible } = await withMapRead(() => api.getMap(data.id, requestedMapId));
          if (!replyIsCurrent(campaignId, generation) || map.id !== requestedMapId) return;
          if (!mapReadIsCurrent(seq, ownRoleWhenStarted, map.id, mapEpochWhenStarted)) {
            rejectStaleOwnRoleHydrate(seq, ownRoleWhenStarted, requestedMapId, mapEpochWhenStarted, 'mapLoad');
            return;
          }
          applyHydratedMap(map, spiritVisible);
        } catch (err) {
          if (!replyIsCurrent(campaignId, generation)) return;
          if (seq !== mapReadSeq.current) return;
          // Catch-up or a live switch already put a map on the table: keep it.
          if (mapEpoch.current !== mapEpochWhenStarted) return;
          if (currentMapIdRef.current && currentMapIdRef.current !== requestedMapId) return;
          // Failed first getMap is an error with retry, never a successful empty table.
          // A pause that bumped statusEpoch is not discarded: the map is still applicable.
          setMapLoadError({
            mapId: requestedMapId,
            message: apiErrorMessage(err) || MAP_LOAD_FALLBACK,
          });
        }
      } else if (!roleMismatch && mapEpoch.current === mapEpochWhenStarted) {
        const seq = bumpMapReadSeq();
        if (seq !== mapReadSeq.current) return;
        currentMapIdRef.current = null;
        setCurrentMapState(null);
      }
    } catch (err) {
      if (!replyIsCurrent(campaignId, generation)) return;
      console.error('Failed to load campaign:', err);

      // Handle specific errors
      if (!leaveOnCampaignAccessError(err)) {
        setError(apiErrorMessage(err) || 'Failed to load campaign');
        setErrorRetryable(true);
      }
    } finally {
      if (generation === loadGeneration.current) {
        setLoading(false);
      }
    }
  }, [leaveOnCampaignAccessError]);

  // Patch roster/settings fields without the page's loading state and
  // without rewriting live tokens or live table fields (status, map, vibe,
  // spirit). A settings PUT already returns the row; member remove and DM
  // transfer GET it again.
  const refreshCampaign = useCallback(async (document?: Campaign, settingsWriteSeq?: number): Promise<boolean> => {
    const campaignId = campaign?.id ?? shownCampaignId.current;
    if (!campaignId) return false;
    const generation = loadGeneration.current;
    const sessionEpochWhenStarted = sessionEpoch.current;
    const statusEpochWhenStarted = statusEpoch.current;
    const mapListGenWhenStarted = mapListGen.current;
    const settingsGenWhenStarted = settingsGen.current;
    const mapEpochWhenStarted = mapEpoch.current;
    const issuedGet = document === undefined;
    // A settings PUT body is not a campaign-row read: do not bump the shared
    // clock. A GET shares it with catch-up and roster.updated. A pretaken
    // settingsWriteSeq is the write's identity (beginSettingsWrite before
    // HTTP); omitting it takes a seq at this apply for older callers.
    const rowSeq = issuedGet ? bumpCampaignRowSeq() : null;
    const settingsSeq = issuedGet
      ? null
      : (settingsWriteSeq ?? nextSettingsWriteSeq());
    try {
      const fresh = document ?? await campaignService.getCampaign(campaignId);
      if (!replyIsCurrent(campaignId, generation) || fresh.id !== campaignId) return false;
      const rowIsCurrent = rowSeq === null || rowSeq === campaignRowSeq.current;
      const roleClockMoved = sessionEpoch.current !== sessionEpochWhenStarted;
      const statusClockMoved = statusEpoch.current !== statusEpochWhenStarted;
      const keepMemberships = !rowIsCurrent || roleClockMoved;
      const keepCharacters = issuedGet && (!rowIsCurrent || roleClockMoved);
      // Apply GET memberships into liveRoleRef before keepMaps so a body
      // that itself demotes this user copies its player-filtered maps and
      // rejects an in-flight DM getMap. Do not adopt when the role clock
      // moved: the socket already patched liveRoleRef and this GET may
      // still list DM.
      let demoted = false;
      if (issuedGet && !keepMemberships) {
        demoted = adoptOwnRoleFromGet(fresh.memberships);
      }
      const keepMaps = issuedGet && (
        !rowIsCurrent
        || keepGetMaps(fresh, mapListGen.current !== mapListGenWhenStarted)
      );
      // PUT: apply when this write started after the last applied write.
      // GET: copy settings only while the applied clock is unchanged since
      // this GET started. beginSettingsWrite does not move that clock.
      const keepSettings = issuedGet
        ? (!rowIsCurrent || settingsGen.current !== settingsGenWhenStarted)
        : settingsSeq !== null && settingsSeq <= settingsGen.current;
      // A discarded settings PUT must not write name, roster, maps, or
      // characters: keepMemberships/keepMaps are false on the PUT path.
      if (!issuedGet && keepSettings) return false;
      applyCampaignDocument(fresh, {
        keepMemberships,
        keepCharacters,
        keepMaps,
        keepSettings,
      });
      if (!issuedGet && !keepSettings && settingsSeq !== null) {
        settingsGen.current = settingsSeq;
      }
      // A current campaign-row GET may copy status/activeSession when the
      // status clock is unchanged. A settings PUT document must not: it is
      // not a live table document.
      if (issuedGet && rowIsCurrent && !statusClockMoved) {
        setCampaign((prev) =>
          prev && prev.id === fresh.id ? { ...prev, status: fresh.status } : prev,
        );
        setActiveSessionState(fresh.activeSession ?? null);
      }
      if (issuedGet && rowIsCurrent) {
        await hydrateWinningRowMap(
          campaignId,
          fresh.currentMapId ?? null,
          mapEpochWhenStarted,
          () => replyIsCurrent(campaignId, generation),
          demoted,
        );
      }
      return issuedGet ? true : !keepSettings;
    } catch (err) {
      if (!replyIsCurrent(campaignId, generation)) return false;
      console.error('[CampaignContext] Failed to refresh campaign:', err);
      if (rowSeq !== null && rowSeq === campaignRowSeq.current) {
        setSyncError(apiErrorMessage(err) || CATCH_UP_FALLBACK);
      }
      return false;
    }
  }, [campaign?.id, applyCampaignDocument]);

  // Re-fetch the current map only — used after a WebSocket reconnect so the
  // local token/wall/light/fog state catches up with anything that broadcast
  // while we were disconnected. Cheaper than a full campaign reload and
  // doesn't blip atmosphere/audio state.
  const refreshCurrentMap = useCallback(async (opts?: { playerDemotion?: boolean }) => {
    const campaignId = campaign?.id;
    const mapId = currentMap?.id;
    if (!campaignId || !mapId) return;
    // A claim of a different id (catch-up hydrating B) must not be stolen.
    // A claim of this same id does not skip: demotion of the on-screen map
    // must bump mapReadSeq so a hung DM getMap of this id cannot apply.
    if (hasConflictingMapClaim(mapId)) return;
    const generation = loadGeneration.current;
    const mapEpochWhenStarted = mapEpoch.current;
    const seq = bumpMapReadSeq();
    const ownRoleWhenStarted = liveRoleRef.current;
    try {
      const { map, spiritVisible } = await withMapRead(() => api.getMap(campaignId, mapId));
      if (!replyIsCurrent(campaignId, generation)) return;
      if (map.id !== mapId) return;
      if (!mapReadIsCurrent(seq, ownRoleWhenStarted, map.id, mapEpochWhenStarted)) {
        rejectStaleOwnRoleHydrate(seq, ownRoleWhenStarted, mapId, mapEpochWhenStarted, 'sync');
        return;
      }
      applyHydratedMap(map, spiritVisible, opts);
    } catch (err) {
      if (!replyIsCurrent(campaignId, generation)) return;
      if (seq !== mapReadSeq.current) return;
      console.error('[CampaignContext] Failed to refresh current map after reconnect:', err);
      // Keep the last frame. Never treat a failed refresh as a successful empty table.
      setSyncError(apiErrorMessage(err) || MAP_REFRESH_FALLBACK);
    }
  }, [campaign?.id, currentMap?.id]);
  refreshCurrentMapRef.current = refreshCurrentMap;

  const retryMapLoad = useCallback(async (): Promise<TableRetryOutcome> => {
    const campaignId = campaign?.id ?? shownCampaignId.current;
    const mapId = mapLoadError?.mapId ?? campaign?.currentMapId;
    if (!campaignId || !mapId) return { ok: false, message: MAP_LOAD_FALLBACK };
    if (hasConflictingMapClaim(mapId)) return { discarded: true };
    const generation = loadGeneration.current;
    const mapEpochWhenStarted = mapEpoch.current;
    const seq = bumpMapReadSeq();
    const ownRoleWhenStarted = liveRoleRef.current;
    try {
      const { map, spiritVisible } = await withMapRead(() => api.getMap(campaignId, mapId));
      if (!replyIsCurrent(campaignId, generation) || map.id !== mapId) {
        return { discarded: true };
      }
      if (!mapReadIsCurrent(seq, ownRoleWhenStarted, map.id, mapEpochWhenStarted)) {
        if (rejectStaleOwnRoleHydrate(seq, ownRoleWhenStarted, mapId, mapEpochWhenStarted, 'mapLoad')) {
          return { ok: false, message: MAP_LOAD_FALLBACK };
        }
        return { discarded: true };
      }
      applyHydratedMap(map, spiritVisible);
      return { ok: true, message: MAP_LOADED_MESSAGE };
    } catch (err) {
      if (!replyIsCurrent(campaignId, generation)) {
        return { discarded: true };
      }
      if (seq !== mapReadSeq.current) {
        return { discarded: true };
      }
      if (!mayApplyFetchedMap(mapId, mapEpochWhenStarted)) {
        return { discarded: true };
      }
      const message = apiErrorMessage(err) || MAP_LOAD_FALLBACK;
      setMapLoadError({
        mapId,
        message,
      });
      return { ok: false, message };
    }
  }, [campaign?.id, campaign?.currentMapId, mapLoadError?.mapId]);

  // Events sent while this page was offline are not replayed: a pause or an
  // end, a member's role, a switch to another map. Re-read them without the
  // full reload's loading screen, then load the map the table is on now,
  // which may not be the one this page had (a player may no longer read it).
  const catchUpAfterReconnect = useCallback(async (): Promise<TableRetryOutcome> => {
    const campaignId = campaign?.id;
    if (!campaignId) return { ok: false, message: CATCH_UP_FALLBACK };
    const generation = loadGeneration.current;
    // Each answer is applied only while the page still shows this campaign
    // at this load generation: one arriving after a switch or unmount would
    // write over the next campaign's singleton token store.
    const stillShown = () => replyIsCurrent(campaignId, generation);
    const mapEpochWhenStarted = mapEpoch.current;
    const sessionEpochWhenStarted = sessionEpoch.current;
    const statusEpochWhenStarted = statusEpoch.current;
    const mapListGenWhenStarted = mapListGen.current;
    const settingsGenWhenStarted = settingsGen.current;
    // One campaign-row sequence with roster.updated GET and refreshCampaign
    // GET. Bump when this catch-up starts so an older GET cannot put back
    // status/memberships/activeSession or surface a stale 403/404/syncError.
    // Do not bump mapReadSeq here: a same-map refresh while GET is in flight
    // must not discard this catch-up after it learns a different currentMapId.
    const rowSeq = bumpCampaignRowSeq();
    try {
      const fresh = await campaignService.getCampaign(campaignId);
      if (!stillShown() || fresh.id !== campaignId) {
        return { discarded: true };
      }
      if (rowSeq !== campaignRowSeq.current) {
        return { discarded: true };
      }
      // Status, memberships, characters, and maps still land even if getMap
      // later fails. Copy status/activeSession while the status clock is
      // unchanged (a concurrent role event must not drop a missed pause).
      // Copy memberships and characters while the role clock is unchanged.
      // Copy maps when this user's role on the body matches liveRoleRef.
      // Do not write currentMapId until a hydrate passes mayApplyFetchedMap
      // — a GET that started on map A must not rewind the table after a
      // live switch.
      const statusClockMoved = statusEpoch.current !== statusEpochWhenStarted;
      const roleClockMoved = sessionEpoch.current !== sessionEpochWhenStarted;
      const demoted = !roleClockMoved ? adoptOwnRoleFromGet(fresh.memberships) : false;
      applyCampaignDocument(fresh, {
        keepMemberships: roleClockMoved,
        keepCharacters: roleClockMoved,
        keepMaps: keepGetMaps(fresh, mapListGen.current !== mapListGenWhenStarted),
        keepSettings: settingsGen.current !== settingsGenWhenStarted,
      });
      if (!statusClockMoved) {
        setCampaign((prev) =>
          prev && prev.id === fresh.id ? { ...prev, status: fresh.status } : prev,
        );
        setActiveSessionState(fresh.activeSession ?? null);
      }
      const mapId = fresh.currentMapId ?? null;
      const outcome = await syncTableToFetchedMapId(
        campaignId,
        mapId,
        mapEpochWhenStarted,
        stillShown,
        { playerDemotion: demoted },
      );
      if (demoted && !('ok' in outcome && outcome.ok === true) && stillShown() && currentMapIdRef.current) {
        await refreshCurrentMapRef.current({ playerDemotion: true });
      }
      return outcome;
    } catch (err) {
      if (!stillShown()) return { discarded: true };
      if (rowSeq !== campaignRowSeq.current) return { discarded: true };
      console.error('[CampaignContext] Failed to refresh the campaign after reconnect:', err);
      if (leaveOnCampaignAccessError(err)) {
        const status = apiErrorStatus(err);
        return {
          ok: false,
          message: status === 404
            ? 'Campaign not found'
            : 'You do not have permission to view this campaign',
        };
      }
      const message = apiErrorMessage(err) || CATCH_UP_FALLBACK;
      setSyncError(message);
      return { ok: false, message };
    }
  }, [campaign?.id, leaveOnCampaignAccessError]);

  // Update currentVibe + activeVibeEffect when vibe.updated WS event arrives
  const updateVibe = useCallback((period: string, hue: string, filter: string) => {
    setCampaign((prev) => (prev ? { ...prev, currentVibe: period } : null));
    setActiveVibeEffect({ hue, filter });
  }, []);

  // Patch campaign.vibeSettings after ConfigureVibeModal saves
  const updateVibeSettings = useCallback((settings: VibeSettings) => {
    setCampaign((prev) => (prev ? { ...prev, vibeSettings: settings } : null));
  }, []);

  // Update campaign.status in local state (called by session WebSocket listeners)
  const updateCampaignStatus = useCallback((status: CampaignStatus) => {
    statusEpoch.current += 1;
    liveStatusRef.current = status;
    setCampaign((prev) => (prev ? { ...prev, status } : null));
  }, []);

  const setActiveSession = useCallback((
    session: { id: string; sessionNumber: number; startedAt: string } | null,
  ) => {
    statusEpoch.current += 1;
    liveSessionWrittenRef.current = true;
    liveSessionRef.current = session;
    setActiveSessionState(session);
  }, []);

  // The campaign's current map and campaign.currentMapId are one fact: every
  // switch goes through here, so the id follows the map. The Map Library
  // re-reads campaign.currentMapId each time it opens for its Active badge,
  // which pointed at the map the page loaded with until this kept it current.
  const setCurrentMap = useCallback((map: Map | null | ((current: Map | null) => Map | null)) => {
    if (typeof map === 'function') {
      setCurrentMapState((current) => {
        const next = map(current);
        // Same-id patches (fog/illumination) must not bump; a real id change
        // including a clear still counts as a live switch.
        adoptLiveMapId(next?.id ?? null);
        return next;
      });
      return;
    }
    adoptLiveMapId(map?.id ?? null);
    setCurrentMapState(map);
    if (map) {
      setMapLoadError(null);
      setCampaign((prev) =>
        prev && prev.currentMapId !== map.id ? { ...prev, currentMapId: map.id } : prev,
      );
    }
  }, []);

  // Keep campaign.maps in step with the Map Library (create, rename, import).
  const upsertCampaignMap = useCallback((map: Map) => {
    mapListGen.current += 1;
    setCampaign((prev) => {
      if (!prev) return prev;
      const maps = prev.maps ?? [];
      return maps.some((m) => m.id === map.id)
        ? { ...prev, maps: maps.map((m) => (m.id === map.id ? map : m)) }
        : { ...prev, maps: [map, ...maps] };
    });
  }, []);

  // Drop a deleted map from campaign.maps.
  const removeCampaignMap = useCallback((mapId: string) => {
    mapListGen.current += 1;
    setCampaign((prev) => {
      if (!prev?.maps) return prev;
      return { ...prev, maps: prev.maps.filter((m) => m.id !== mapId) };
    });
  }, []);

  // Update atmosphere effect (called by AtmospherePlayer on WS broadcast)
  const updateAtmosphereEffect = useCallback((effect: string | null) => {
    setActiveAtmosphereEffect(effect);
  }, []);

  // Update atmosphere audio (called by AtmospherePlayer on WS broadcast)
  const updateAtmosphereAudio = useCallback((audio: { assetId: string; audioUrl: string; volume: number; loop: boolean } | null) => {
    setActiveAtmosphereAudio(audio);
  }, []);

  // Seed HP cache from roster API response (called by CampaignRoster after fetchRoster)
  const seedCharacterHpCache = useCallback((entries: { id: string; hp: CharacterHpInfo | null }[]) => {
    setCharacterHpCache((prev) => {
      const next = { ...prev };
      for (const { id, hp } of entries) {
        if (hp) next[id] = hp;
      }
      return next;
    });
  }, []);

  // Listen for real-time character HP updates
  useEffect(() => {
    const handleHpUpdated = (data: CharacterHpUpdatedBroadcast) => {
      setCharacterHpCache((prev) => ({
        ...prev,
        [data.characterId]: data.hp,
      }));
    };

    socketClient.onCharacterHpUpdated(handleHpUpdated);
    return () => {
      socketClient.off('character.hp.updated', handleHpUpdated);
    };
  }, []);

  /**
   * The DM seat moved.
   *
   * `userRole` is derived from the membership list, and everything that asks
   * "am I the DM?" reads it, so patching the list here brings the whole page
   * into line — the controls a DM gets appear, and the ones a former DM had
   * disappear, without a reload. The server has already changed what it will
   * accept, so a page still offering the old controls would only produce
   * refusals.
   */
  useEffect(() => {
    const handleDmTransferred = (data: DmTransferredBroadcast) => {
      const ownId = userIdRef.current;
      const isOwnSeat = Boolean(ownId && (ownId === data.newDmId || ownId === data.previousDmId));
      if (ownId && shownCampaignId.current === data.campaignId) {
        if (ownId === data.newDmId) noteOwnLiveRole(data.campaignId, 'DM' as CampaignRole);
        else if (ownId === data.previousDmId) noteOwnLiveRole(data.campaignId, 'PLAYER' as CampaignRole);
      }
      setCampaign((prev) => {
        if (!prev || prev.id !== data.campaignId || !prev.memberships) return prev;
        // Own-seat transfer already bumped via noteOwnLiveRole. A transfer
        // of the DM seat among other members is a membership change.
        if (!isOwnSeat) sessionEpoch.current += 1;
        return {
          ...prev,
          memberships: prev.memberships.map((m) =>
            m.userId === data.newDmId
              ? { ...m, role: 'DM' as CampaignRole }
              : m.userId === data.previousDmId
                ? { ...m, role: 'PLAYER' as CampaignRole }
                : m
          ),
        };
      });
    };

    socketClient.onDmTransferred(handleDmTransferred);
    return () => {
      socketClient.off('campaign.dm.transferred', handleDmTransferred);
    };
  }, []);

  /**
   * A member's role changed, possibly this user's own. The server has
   * already applied it to what it accepts, so the page follows: `userRole`
   * is read from the membership list. The `authenticated` reply also carries
   * this user's role, which catches a change made while this page was
   * offline and never heard.
   */
  useEffect(() => {
    const handleRoleChanged = (data: MemberRoleChangedBroadcast) => {
      const isOwn = Boolean(userIdRef.current && data.userId === userIdRef.current);
      const ownBumped = isOwn ? noteOwnLiveRole(data.campaignId, data.role) : false;
      setCampaign((prev) => {
        if (!prev || prev.id !== data.campaignId) return prev;
        const next = withMemberRole(prev, data.userId, data.role);
        // Same role is not a live update. Reconnect `authenticated` with the
        // role we already have must not bump, or catch-up would skip
        // memberships that arrived only as GET.
        if (next !== prev && !ownBumped) sessionEpoch.current += 1;
        return next;
      });
    };
    const handleAuthenticated = (data: { campaignId?: string; userId?: string; role?: CampaignRole }) => {
      if (!data?.campaignId || !data.userId || !data.role) return;
      const { campaignId, userId, role } = data;
      const isOwn = Boolean(userIdRef.current && userId === userIdRef.current);
      const ownBumped = isOwn ? noteOwnLiveRole(campaignId, role) : false;
      setCampaign((prev) => {
        if (!prev || prev.id !== campaignId) return prev;
        const next = withMemberRole(prev, userId, role);
        if (next !== prev && !ownBumped) sessionEpoch.current += 1;
        return next;
      });
    };
    // Someone joined, left, or brought a character: the roster refetches, and
    // so do the member list everything else on the page reads (Duplicate
    // keeps a token's controller only while they are a player here) and the
    // campaign's characters (which tokens offer View Character Sheet and Roll).
    const handleRosterUpdated = (data: { campaignId?: string }) => {
      const campaignId = data?.campaignId;
      if (!campaignId) return;
      const generation = loadGeneration.current;
      const sessionEpochWhenStarted = sessionEpoch.current;
      const statusEpochWhenStarted = statusEpoch.current;
      const mapListGenWhenStarted = mapListGen.current;
      const settingsGenWhenStarted = settingsGen.current;
      const mapEpochWhenStarted = mapEpoch.current;
      const seq = bumpCampaignRowSeq();
      campaignService
        .getCampaign(campaignId)
        .then(async (fresh) => {
          if (generation !== loadGeneration.current) return;
          if (shownCampaignId.current !== fresh.id) return;
          if (seq !== campaignRowSeq.current) return;
          const roleClockMoved = sessionEpoch.current !== sessionEpochWhenStarted;
          const statusClockMoved = statusEpoch.current !== statusEpochWhenStarted;
          const keepMemberships = roleClockMoved;
          const demoted = !keepMemberships ? adoptOwnRoleFromGet(fresh.memberships) : false;
          applyCampaignDocument(fresh, {
            keepMemberships,
            keepCharacters: false,
            keepMaps: keepGetMaps(fresh, mapListGen.current !== mapListGenWhenStarted),
            keepSettings: settingsGen.current !== settingsGenWhenStarted,
          });
          if (!statusClockMoved) {
            setCampaign((prev) =>
              prev && prev.id === fresh.id ? { ...prev, status: fresh.status } : prev,
            );
            setActiveSessionState(fresh.activeSession ?? null);
          }
          await hydrateWinningRowMap(
            fresh.id,
            fresh.currentMapId ?? null,
            mapEpochWhenStarted,
            () => generation === loadGeneration.current && shownCampaignId.current === fresh.id,
            demoted,
          );
        })
        .catch((err: unknown) => {
          console.error('[CampaignContext] Failed to refresh members:', err);
          if (generation !== loadGeneration.current) return;
          if (shownCampaignId.current !== campaignId) return;
          if (seq !== campaignRowSeq.current) return;
          setSyncError(apiErrorMessage(err) || CATCH_UP_FALLBACK);
        });
    };
    socketClient.onMemberRoleChanged(handleRoleChanged);
    socketClient.on('authenticated', handleAuthenticated);
    socketClient.on('roster.updated', handleRosterUpdated);
    return () => {
      socketClient.off('campaign.role.changed', handleRoleChanged);
      socketClient.off('authenticated', handleAuthenticated);
      socketClient.off('roster.updated', handleRosterUpdated);
    };
  }, []);

  // Update spirit layer enabled/style in local campaign state
  const updateCampaignSpiritLayer = useCallback((enabled: boolean, style?: string) => {
    setCampaign((prev) =>
      prev
        ? {
            ...prev,
            spiritLayerEnabled: enabled,
            spiritLayerStyle: style ?? prev.spiritLayerStyle,
          }
        : null
    );
  }, []);

  // Load campaign on mount or when ID changes.
  // The game store is a module singleton (it outlives this provider), so
  // clear it before loading a different campaign and on unmount — otherwise
  // the previous campaign's tokens would flash on the next session screen.
  useEffect(() => {
    useGameStore.getState().clearGameState();
    if (id) {
      loadCampaign(id);
    }
    return () => {
      // A late REST reply must not write the singleton game store after this
      // page has closed or moved to another campaign.
      bumpGeneration();
      shownCampaignId.current = null;
      useGameStore.getState().clearGameState();
    };
  }, [id, loadCampaign]);

  // Context value — memoized so consumers only re-render when a field they
  // read actually changes, not on every provider render (e.g. token moves
  // no longer force the whole campaign subtree to reconcile).
  const value: CampaignContextState = useMemo(() => ({
    campaign,
    currentMap,
    mapGeometryGen,
    userRole,
    loading,
    error,
    errorRetryable,
    mapLoadError,
    syncError,
    loadCampaign,
    refreshCampaign,
    beginSettingsWrite,
    retryMapLoad,
    refreshCurrentMap,
    catchUpAfterReconnect,
    setCurrentMap,
    upsertCampaignMap,
    removeCampaignMap,
    updateCampaignSpiritLayer,
    dmViewBothPlanes,
    setDmViewBothPlanes,
    playerSpiritVisible,
    setPlayerSpiritVisible,
    currentVibe,
    activeVibeEffect,
    updateVibe,
    updateVibeSettings,
    activeSession,
    setActiveSession,
    updateCampaignStatus,
    activeAtmosphereEffect,
    updateAtmosphereEffect,
    activeAtmosphereAudio,
    updateAtmosphereAudio,
    characterHpCache,
    seedCharacterHpCache,
  }), [
    campaign,
    currentMap,
    mapGeometryGen,
    userRole,
    loading,
    error,
    errorRetryable,
    mapLoadError,
    syncError,
    loadCampaign,
    refreshCampaign,
    beginSettingsWrite,
    retryMapLoad,
    refreshCurrentMap,
    catchUpAfterReconnect,
    upsertCampaignMap,
    removeCampaignMap,
    updateCampaignSpiritLayer,
    dmViewBothPlanes,
    playerSpiritVisible,
    currentVibe,
    activeVibeEffect,
    updateVibe,
    updateVibeSettings,
    activeSession,
    updateCampaignStatus,
    activeAtmosphereEffect,
    updateAtmosphereEffect,
    activeAtmosphereAudio,
    updateAtmosphereAudio,
    characterHpCache,
    seedCharacterHpCache,
  ]);

  return (
    <CampaignContext.Provider value={value}>
      {children}
    </CampaignContext.Provider>
  );
}

// ============================================
// Hook for consuming context
// ============================================

export function useCampaign() {
  const context = useContext(CampaignContext);

  if (context === undefined) {
    throw new Error('useCampaign must be used within a CampaignProvider');
  }

  return context;
}
