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
import type { Campaign, CampaignRole, CampaignStatus, Map, VibeSettings, VibePeriod, CharacterHpUpdatedBroadcast, DmTransferredBroadcast, MemberRoleChangedBroadcast } from '@/types';
import type { CharacterHpInfo } from '@/utils/characterHp';
import socketClient from '@/services/socket';
import { apiErrorMessage, apiErrorStatus } from '@/utils/errors';
import { withMemberRole } from '@/utils/campaignRoles';

// ============================================
// Types
// ============================================

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
   * Resolves true when a hydrate is applied; false on failure or a discarded reply.
   */
  retryMapLoad: () => Promise<boolean>;
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
   * Resolves true when a hydrate is applied or catch-up otherwise succeeds;
   * false on failure or a discarded reply.
   */
  catchUpAfterReconnect: () => Promise<boolean>;
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
  const bumpGeneration = () => {
    loadGeneration.current += 1;
    return loadGeneration.current;
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
  const [activeSession, setActiveSession] = useState<{ id: string; sessionNumber: number; startedAt: string } | null>(null);
  // Atmosphere state — effect + audio
  const [activeAtmosphereEffect, setActiveAtmosphereEffect] = useState<string | null>(null);
  const [activeAtmosphereAudio, setActiveAtmosphereAudio] = useState<{ assetId: string; audioUrl: string; volume: number; loop: boolean } | null>(null);
  // Character HP cache — keyed by characterId, updated by WS event and roster seed
  const [characterHpCache, setCharacterHpCache] = useState<Record<string, CharacterHpInfo>>({});

  /**
   * A map GET that started while the table showed `mapWhenStarted` must not
   * overwrite a live switch to a third map. If the table still shows the
   * map we started on, the reply may change it (catch-up learned of a switch).
   * If the table already shows the fetched map, applying it is a hydrate.
   */
  const liveMapDidNotMoveOn = (fetchedMapId: string, mapWhenStarted: string | null) => {
    const now = currentMapIdRef.current;
    if (now && now !== mapWhenStarted && now !== fetchedMapId) return false;
    return true;
  };
  const applyHydratedMap = (map: Map, spiritVisible?: boolean) => {
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
  const applyCampaignDocument = useCallback((fresh: Campaign) => {
    setCampaign((prev) => {
      if (!prev || prev.id !== fresh.id) return prev;
      return {
        ...prev,
        name: fresh.name,
        description: fresh.description,
        chatCooldownEnabled: fresh.chatCooldownEnabled ?? prev.chatCooldownEnabled,
        chatCooldownSeconds: fresh.chatCooldownSeconds ?? prev.chatCooldownSeconds,
        memberships: fresh.memberships ?? prev.memberships,
        characters: fresh.characters ?? prev.characters,
        maps: fresh.maps ?? prev.maps,
        ownerId: fresh.ownerId ?? prev.ownerId,
        gameSystem: fresh.gameSystem ?? prev.gameSystem,
      };
    });
  }, []);

  // Load campaign data
  const loadCampaign = useCallback(async (campaignId: string) => {
    const generation = bumpGeneration();
    shownCampaignId.current = campaignId;
    setLoading(true);
    setError(null);
    setErrorRetryable(false);
    setMapLoadError(null);
    setSyncError(null);
    // Drop the previous campaign's row and map so a switch cannot keep the
    // last table on screen, and a failed getMap cannot sit on top of it.
    setCampaign(null);
    setCurrentMapState(null);

    try {
      const data = await campaignService.getCampaign(campaignId);
      if (!replyIsCurrent(campaignId, generation) || data.id !== campaignId) return;
      setCampaign(data);

      // Initialize active session from campaign response
      setActiveSession(data.activeSession ?? null);

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
      if (data.currentMapId) {
        const requestedMapId = data.currentMapId;
        const mapWhenStarted = currentMapIdRef.current;
        try {
          const { map, spiritVisible } = await api.getMap(data.id, requestedMapId);
          if (!replyIsCurrent(campaignId, generation) || map.id !== requestedMapId) return;
          if (!liveMapDidNotMoveOn(map.id, mapWhenStarted)) return;
          applyHydratedMap(map, spiritVisible);
        } catch (err) {
          if (!replyIsCurrent(campaignId, generation)) return;
          // Catch-up or a live switch already put a map on the table: keep it.
          if (currentMapIdRef.current && currentMapIdRef.current !== requestedMapId) return;
          // Failed first getMap is an error with retry, never a successful empty table.
          setMapLoadError({
            mapId: requestedMapId,
            message: apiErrorMessage(err) || 'Failed to load map',
          });
        }
      } else {
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
    try {
      const fresh = document ?? await campaignService.getCampaign(campaignId);
      if (!replyIsCurrent(campaignId, generation) || fresh.id !== campaignId) return;
      applyCampaignDocument(fresh);
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
    const mapWhenStarted = mapId;
    try {
      const { map, spiritVisible } = await api.getMap(campaignId, mapId);
      if (!replyIsCurrent(campaignId, generation)) return;
      if (map.id !== mapId || !liveMapDidNotMoveOn(map.id, mapWhenStarted)) return;
      applyHydratedMap(map, spiritVisible);
    } catch (err) {
      if (!replyIsCurrent(campaignId, generation)) return;
      console.error('[CampaignContext] Failed to refresh current map after reconnect:', err);
      // Keep the last frame. Never treat a failed refresh as a successful empty table.
      setSyncError(apiErrorMessage(err) || 'Failed to refresh the current map');
    }
  }, [campaign?.id, currentMap?.id]);

  const retryMapLoad = useCallback(async (): Promise<boolean> => {
    const campaignId = campaign?.id ?? shownCampaignId.current;
    const mapId = mapLoadError?.mapId ?? campaign?.currentMapId;
    if (!campaignId || !mapId) return false;
    const generation = bumpGeneration();
    const mapWhenStarted = currentMapIdRef.current;
    try {
      const { map, spiritVisible } = await api.getMap(campaignId, mapId);
      if (!replyIsCurrent(campaignId, generation) || map.id !== mapId) return false;
      if (!liveMapDidNotMoveOn(map.id, mapWhenStarted)) return false;
      applyHydratedMap(map, spiritVisible);
      return true;
    } catch (err) {
      if (!replyIsCurrent(campaignId, generation)) return false;
      setMapLoadError({
        mapId,
        message: apiErrorMessage(err) || 'Failed to load map',
      });
      return false;
    }
  }, [campaign?.id, campaign?.currentMapId, mapLoadError?.mapId]);

  // Events sent while this page was offline are not replayed: a pause or an
  // end, a member's role, a switch to another map. Re-read them without the
  // full reload's loading screen, then load the map the table is on now,
  // which may not be the one this page had (a player may no longer read it).
  const catchUpAfterReconnect = useCallback(async (): Promise<boolean> => {
    const campaignId = campaign?.id;
    if (!campaignId) return false;
    const generation = loadGeneration.current;
    // Each answer is applied only while the page still shows this campaign
    // at this load generation: one arriving after a switch or unmount would
    // write over the next campaign's singleton token store.
    const stillShown = () => replyIsCurrent(campaignId, generation);
    const mapWhenStarted = currentMapIdRef.current;
    let mapId: string | null;
    try {
      const fresh = await campaignService.getCampaign(campaignId);
      if (!stillShown() || fresh.id !== campaignId) return false;
      // Pause/role still land even if getMap later fails. Do not write
      // currentMapId until a hydrate passes liveMapDidNotMoveOn — a GET
      // that started on map A must not rewind the table after a live switch.
      setCampaign((prev) =>
        prev && prev.id === fresh.id
          ? { ...prev, status: fresh.status, memberships: fresh.memberships }
          : prev
      );
      setActiveSession(fresh.activeSession ?? null);
      mapId = fresh.currentMapId ?? null;
    } catch (err) {
      if (!stillShown()) return false;
      console.error('[CampaignContext] Failed to refresh the campaign after reconnect:', err);
      if (leaveOnCampaignAccessError(err)) return false;
      setSyncError(apiErrorMessage(err) || 'Failed to catch up after reconnect');
      return false;
    }
    if (!mapId) {
      if (!stillShown()) return false;
      if (currentMapIdRef.current === mapWhenStarted) {
        setCurrentMapState(null);
        useGameStore.getState().setTokens([]);
        setCampaign((prev) => (prev ? { ...prev, currentMapId: null } : prev));
        setSyncError(null);
        setMapLoadError(null);
        return true;
      }
      // Live table already switched maps while GET was in flight: do not rewind.
      return false;
    }
    if (!liveMapDidNotMoveOn(mapId, mapWhenStarted)) return false;
    try {
      const { map, spiritVisible } = await api.getMap(campaignId, mapId);
      if (!stillShown() || map.id !== mapId) return false;
      if (!liveMapDidNotMoveOn(map.id, mapWhenStarted)) return false;
      applyHydratedMap(map, spiritVisible);
      setCampaign((prev) =>
        prev && prev.currentMapId !== map.id ? { ...prev, currentMapId: map.id } : prev,
      );
      return true;
    } catch (err) {
      if (!stillShown()) return false;
      console.error('[CampaignContext] Failed to refresh the current map after reconnect:', err);
      setSyncError(apiErrorMessage(err) || 'Failed to refresh the current map');
      return false;
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
    setCampaign((prev) => (prev ? { ...prev, status } : null));
  }, []);

  // The campaign's current map and campaign.currentMapId are one fact: every
  // switch goes through here, so the id follows the map. The Map Library
  // re-reads campaign.currentMapId each time it opens for its Active badge,
  // which pointed at the map the page loaded with until this kept it current.
  const setCurrentMap = useCallback((map: Map | null | ((current: Map | null) => Map | null)) => {
    if (typeof map === 'function') {
      setCurrentMapState(map);
      return;
    }
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
      setCampaign((prev) => {
        if (!prev || prev.id !== data.campaignId || !prev.memberships) return prev;
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
      setCampaign((prev) => (prev && prev.id === data.campaignId ? withMemberRole(prev, data.userId, data.role) : prev));
    };
    const handleAuthenticated = (data: { campaignId?: string; userId?: string; role?: CampaignRole }) => {
      if (!data?.campaignId || !data.userId || !data.role) return;
      const { campaignId, userId, role } = data;
      setCampaign((prev) => (prev && prev.id === campaignId ? withMemberRole(prev, userId, role) : prev));
    };
    // Someone joined, left, or brought a character: the roster refetches, and
    // so do the member list everything else on the page reads (Duplicate
    // keeps a token's controller only while they are a player here) and the
    // campaign's characters (which tokens offer View Character Sheet and Roll).
    const handleRosterUpdated = (data: { campaignId?: string }) => {
      const campaignId = data?.campaignId;
      if (!campaignId) return;
      const generation = loadGeneration.current;
      campaignService
        .getCampaign(campaignId)
        .then((fresh) => {
          if (generation !== loadGeneration.current) return;
          if (shownCampaignId.current !== fresh.id) return;
          setCampaign((prev) => (prev && prev.id === fresh.id
            ? { ...prev, memberships: fresh.memberships, characters: fresh.characters ?? prev.characters }
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
