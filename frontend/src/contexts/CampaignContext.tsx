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
 * A discarded reply (stale generation, live map switch, overlapping map
 * read, or session/role change) is distinct and must not be announced.
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
   * owner, game system). Does not copy live table fields: status,
   * currentMapId, vibe, and spirit stay on the socket. Catch-up re-reads
   * status, memberships, and currentMapId (the id only with a live-map
   * hydrate). Does not set `loading` or rewrite tokens. Given a document
   * (the body a settings PUT already returned), apply it; otherwise GET
   * the row and apply that.
   */
  refreshCampaign: (document?: Campaign) => Promise<void>;
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
  // Live session/role updates: pause, resume, DM transfer, role change.
  // Independent of mapEpoch. roster.updated GET, refreshCampaign, and
  // vibe/spirit do not bump this.
  const sessionEpoch = useRef(0);
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
  // This user's latest own role for the campaign the page is showing, even
  // while `campaign` is still null (first load). Demotion during getCampaign
  // would otherwise be dropped because handleRoleChanged / authenticated
  // return immediately when there is no row.
  const liveRoleRef = useRef<CampaignRole | null>(null);
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
  /**
   * Record this user's own role for the shown campaign. Same role is not a
   * live update. Reconnect `authenticated` with the role we already have
   * must not bump, or catch-up would skip a missed pause that arrived only
   * as GET. The first record (ref was empty) is not a change either: the
   * socket often authenticates while the first getCampaign is still in
   * flight, and bumping then would treat a matching GET as stale.
   */
  const noteOwnLiveRole = (campaignId: string, role: CampaignRole): boolean => {
    if (shownCampaignId.current !== campaignId) return false;
    if (liveRoleRef.current === role) return false;
    const hadRole = liveRoleRef.current !== null;
    liveRoleRef.current = role;
    if (!hadRole) return false;
    sessionEpoch.current += 1;
    return true;
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

  const mapReadIsCurrent = (
    seq: number,
    sessionEpochWhenStarted: number,
    fetchedMapId: string,
    mapEpochWhenStarted: number,
  ) =>
    seq === mapReadSeq.current
    && sessionEpoch.current === sessionEpochWhenStarted
    && mayApplyFetchedMap(fetchedMapId, mapEpochWhenStarted);

  const applyHydratedMap = (map: Map, spiritVisible?: boolean) => {
    currentMapIdRef.current = map.id;
    setCurrentMapState(map);
    useGameStore.getState().setTokens(map.tokens || []);
    setPlayerSpiritVisible(spiritVisible ?? false);
    setMapLoadError(null);
    setSyncError(null);
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
  const applyCampaignDocument = useCallback((
    fresh: Campaign,
    keepMemberships = false,
    keepCharacters = false,
  ) => {
    setCampaign((prev) => {
      if (!prev || prev.id !== fresh.id) return prev;
      return {
        ...prev,
        name: fresh.name,
        description: fresh.description,
        chatCooldownEnabled: fresh.chatCooldownEnabled ?? prev.chatCooldownEnabled,
        chatCooldownSeconds: fresh.chatCooldownSeconds ?? prev.chatCooldownSeconds,
        memberships: keepMemberships ? prev.memberships : (fresh.memberships ?? prev.memberships),
        characters: keepCharacters ? prev.characters : (fresh.characters ?? prev.characters),
        maps: fresh.maps ?? prev.maps,
        ownerId: fresh.ownerId ?? prev.ownerId,
        gameSystem: fresh.gameSystem ?? prev.gameSystem,
      };
    });
  }, []);

  // Load campaign data
  const loadCampaign = useCallback(async (campaignId: string) => {
    const generation = bumpGeneration();
    // Reset liveRoleRef only when the loaded campaign id changes, not on
    // every retry of the same id — a demotion heard during the first GET
    // must still force PLAYER on a retry of that row.
    if (shownCampaignId.current !== campaignId) {
      liveRoleRef.current = null;
    }
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
    const sessionEpochWhenStarted = sessionEpoch.current;

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
      const epochMoved = sessionEpoch.current !== sessionEpochWhenStarted;
      if (roleMismatch) {
        const role = liveRole;
        setCampaign({
          ...data,
          maps: [],
          memberships: ownId && role ? [membershipWithRole(data, ownId, role)] : [],
        });
      } else if (epochMoved) {
        // A live pause/role of someone else arrived while GET was in flight.
        // Do not copy this GET's memberships or extra maps; still install
        // enough of the row that userRole can be derived, and hydrate the
        // current map only when the body matches this user's live role.
        const role = liveRole ?? ownFromGet;
        setCampaign({
          ...data,
          maps: [],
          memberships: ownId && role ? [membershipWithRole(data, ownId, role)] : [],
        });
        if (role && !liveRole) liveRoleRef.current = role;
      } else {
        setCampaign(data);
        if (ownFromGet) liveRoleRef.current = ownFromGet;
      }

      // Initialize active session from campaign response
      setActiveSessionState(data.activeSession ?? null);

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
        const sessionEpochWhenMapStarted = sessionEpoch.current;
        try {
          const { map, spiritVisible } = await api.getMap(data.id, requestedMapId);
          if (!replyIsCurrent(campaignId, generation) || map.id !== requestedMapId) return;
          if (!mapReadIsCurrent(seq, sessionEpochWhenMapStarted, map.id, mapEpochWhenStarted)) return;
          applyHydratedMap(map, spiritVisible);
        } catch (err) {
          if (!replyIsCurrent(campaignId, generation)) return;
          if (seq !== mapReadSeq.current) return;
          // Catch-up or a live switch already put a map on the table: keep it.
          if (mapEpoch.current !== mapEpochWhenStarted) return;
          if (currentMapIdRef.current && currentMapIdRef.current !== requestedMapId) return;
          // Failed first getMap is an error with retry, never a successful empty table.
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
  const refreshCampaign = useCallback(async (document?: Campaign) => {
    const campaignId = campaign?.id ?? shownCampaignId.current;
    if (!campaignId) return;
    const generation = loadGeneration.current;
    const sessionEpochWhenStarted = sessionEpoch.current;
    const issuedGet = document === undefined;
    // A settings PUT body is not a campaign-row read: do not bump the shared
    // clock. A GET shares it with catch-up and roster.updated.
    const rowSeq = issuedGet ? bumpCampaignRowSeq() : null;
    try {
      const fresh = document ?? await campaignService.getCampaign(campaignId);
      if (!replyIsCurrent(campaignId, generation) || fresh.id !== campaignId) return;
      const rowIsCurrent = rowSeq === null || rowSeq === campaignRowSeq.current;
      const epochMoved = sessionEpoch.current !== sessionEpochWhenStarted;
      const keepMemberships = !rowIsCurrent || epochMoved;
      const keepCharacters = issuedGet && (!rowIsCurrent || epochMoved);
      applyCampaignDocument(fresh, keepMemberships, keepCharacters);
    } catch (err) {
      if (!replyIsCurrent(campaignId, generation)) return;
      console.error('[CampaignContext] Failed to refresh campaign:', err);
    }
  }, [campaign?.id, applyCampaignDocument]);

  // Re-fetch the current map only — used after a WebSocket reconnect so the
  // local token/wall/light/fog state catches up with anything that broadcast
  // while we were disconnected. Cheaper than a full campaign reload and
  // doesn't blip atmosphere/audio state.
  const refreshCurrentMap = useCallback(async () => {
    const campaignId = campaign?.id;
    const mapId = currentMap?.id;
    if (!campaignId || !mapId) return;
    const generation = loadGeneration.current;
    const mapEpochWhenStarted = mapEpoch.current;
    const seq = bumpMapReadSeq();
    const sessionEpochWhenStarted = sessionEpoch.current;
    try {
      const { map, spiritVisible } = await api.getMap(campaignId, mapId);
      if (!replyIsCurrent(campaignId, generation)) return;
      if (map.id !== mapId) return;
      if (!mapReadIsCurrent(seq, sessionEpochWhenStarted, map.id, mapEpochWhenStarted)) return;
      applyHydratedMap(map, spiritVisible);
    } catch (err) {
      if (!replyIsCurrent(campaignId, generation)) return;
      if (seq !== mapReadSeq.current) return;
      console.error('[CampaignContext] Failed to refresh current map after reconnect:', err);
      // Keep the last frame. Never treat a failed refresh as a successful empty table.
      setSyncError(apiErrorMessage(err) || MAP_REFRESH_FALLBACK);
    }
  }, [campaign?.id, currentMap?.id]);

  const retryMapLoad = useCallback(async (): Promise<TableRetryOutcome> => {
    const campaignId = campaign?.id ?? shownCampaignId.current;
    const mapId = mapLoadError?.mapId ?? campaign?.currentMapId;
    if (!campaignId || !mapId) return { ok: false, message: MAP_LOAD_FALLBACK };
    const generation = loadGeneration.current;
    const mapEpochWhenStarted = mapEpoch.current;
    const seq = bumpMapReadSeq();
    const sessionEpochWhenStarted = sessionEpoch.current;
    try {
      const { map, spiritVisible } = await api.getMap(campaignId, mapId);
      if (!replyIsCurrent(campaignId, generation) || map.id !== mapId) {
        return { discarded: true };
      }
      if (!mapReadIsCurrent(seq, sessionEpochWhenStarted, map.id, mapEpochWhenStarted)) {
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
      if (sessionEpoch.current !== sessionEpochWhenStarted) {
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
    // One campaign-row sequence with roster.updated GET and refreshCampaign
    // GET. Bump when this catch-up starts so an older GET cannot put back
    // status/memberships/activeSession or surface a stale 403/404/syncError.
    // Do not bump mapReadSeq here: a same-map refresh while GET is in flight
    // must not discard this catch-up after it learns a different currentMapId.
    const rowSeq = bumpCampaignRowSeq();
    let mapId: string | null;
    try {
      const fresh = await campaignService.getCampaign(campaignId);
      if (!stillShown() || fresh.id !== campaignId) {
        return { discarded: true };
      }
      if (rowSeq !== campaignRowSeq.current) {
        return { discarded: true };
      }
      // Pause/role still land even if getMap later fails, but only when no
      // live session/role update arrived while GET was in flight. Do not write
      // currentMapId until a hydrate passes mayApplyFetchedMap — a GET that
      // started on map A must not rewind the table after a live switch.
      if (sessionEpoch.current === sessionEpochWhenStarted) {
        setCampaign((prev) =>
          prev && prev.id === fresh.id
            ? { ...prev, status: fresh.status, memberships: fresh.memberships }
            : prev
        );
        setActiveSessionState(fresh.activeSession ?? null);
        const ownId = userIdRef.current;
        const own = ownId
          ? fresh.memberships?.find((m) => m.userId === ownId)
          : undefined;
        if (own) liveRoleRef.current = own.role;
      }
      mapId = fresh.currentMapId ?? null;
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
    if (!mapId) {
      if (!stillShown()) return { discarded: true };
      if (mapEpoch.current === mapEpochWhenStarted) {
        // Bump immediately before the clear so an in-flight getMap of the
        // previous id cannot apply.
        const seq = bumpMapReadSeq();
        if (seq !== mapReadSeq.current) return { discarded: true };
        currentMapIdRef.current = null;
        setCurrentMapState(null);
        useGameStore.getState().setTokens([]);
        setCampaign((prev) => (prev ? { ...prev, currentMapId: null } : prev));
        setSyncError(null);
        setMapLoadError(null);
        return { ok: true, message: TABLE_SYNCED_MESSAGE };
      }
      // Live table already switched maps while GET was in flight (including
      // A→B→A): do not rewind or clear.
      return { discarded: true };
    }
    if (!mayApplyFetchedMap(mapId, mapEpochWhenStarted)) {
      return { discarded: true };
    }
    // Catch-up is now the latest read of this id (same map or a learned
    // switch). An in-flight getMap of the previous id has the older seq.
    const seq = bumpMapReadSeq();
    const sessionEpochWhenMapStarted = sessionEpoch.current;
    try {
      const { map, spiritVisible } = await api.getMap(campaignId, mapId);
      if (!stillShown() || map.id !== mapId) {
        return { discarded: true };
      }
      if (!mapReadIsCurrent(seq, sessionEpochWhenMapStarted, map.id, mapEpochWhenStarted)) {
        return { discarded: true };
      }
      applyHydratedMap(map, spiritVisible);
      setCampaign((prev) =>
        prev && prev.currentMapId !== map.id ? { ...prev, currentMapId: map.id } : prev,
      );
      return { ok: true, message: TABLE_SYNCED_MESSAGE };
    } catch (err) {
      if (!stillShown()) return { discarded: true };
      if (seq !== mapReadSeq.current) return { discarded: true };
      if (sessionEpoch.current !== sessionEpochWhenMapStarted) return { discarded: true };
      if (!mayApplyFetchedMap(mapId, mapEpochWhenStarted)) return { discarded: true };
      console.error('[CampaignContext] Failed to refresh the current map after reconnect:', err);
      const message = apiErrorMessage(err) || MAP_REFRESH_FALLBACK;
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
    sessionEpoch.current += 1;
    setCampaign((prev) => (prev ? { ...prev, status } : null));
  }, []);

  const setActiveSession = useCallback((
    session: { id: string; sessionNumber: number; startedAt: string } | null,
  ) => {
    sessionEpoch.current += 1;
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
      if (ownId && shownCampaignId.current === data.campaignId) {
        if (ownId === data.newDmId) noteOwnLiveRole(data.campaignId, 'DM' as CampaignRole);
        else if (ownId === data.previousDmId) noteOwnLiveRole(data.campaignId, 'PLAYER' as CampaignRole);
      }
      setCampaign((prev) => {
        if (!prev || prev.id !== data.campaignId || !prev.memberships) return prev;
        sessionEpoch.current += 1;
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
        // role we already have must not bump, or catch-up would skip a missed
        // pause that arrived only as GET.
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
      const seq = bumpCampaignRowSeq();
      campaignService
        .getCampaign(campaignId)
        .then((fresh) => {
          if (generation !== loadGeneration.current) return;
          if (shownCampaignId.current !== fresh.id) return;
          if (seq !== campaignRowSeq.current) return;
          const keepMemberships = sessionEpoch.current !== sessionEpochWhenStarted;
          setCampaign((prev) => (prev && prev.id === fresh.id
            ? {
                ...prev,
                memberships: keepMemberships ? prev.memberships : fresh.memberships,
                characters: fresh.characters ?? prev.characters,
              }
            : prev));
        })
        .catch((err: unknown) => console.error('[CampaignContext] Failed to refresh members:', err));
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
    userRole,
    loading,
    error,
    errorRetryable,
    mapLoadError,
    syncError,
    loadCampaign,
    refreshCampaign,
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
    userRole,
    loading,
    error,
    errorRetryable,
    mapLoadError,
    syncError,
    loadCampaign,
    refreshCampaign,
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
