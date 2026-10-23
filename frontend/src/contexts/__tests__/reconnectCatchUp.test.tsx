/**
 * What a page catches up on after its connection comes back.
 *
 * Pausing or ending the session, a member's role and a map switch arrive as
 * events, and events sent while a page was offline are not replayed. The
 * page refetched only the map it was on, so a player who missed a pause was
 * still offered drags the server refused, and one who missed a map switch
 * asked for a map they may no longer read.
 */

import { it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const getCampaign = vi.fn();
const getMap = vi.fn();
vi.mock('@/services/campaign.service', () => ({ default: { getCampaign: (...a: unknown[]) => getCampaign(...a) } }));
vi.mock('@/services/api', () => ({
  default: { getMap: (...a: unknown[]) => getMap(...a), pingSession: vi.fn() },
  api: { getMap: (...a: unknown[]) => getMap(...a), pingSession: vi.fn() },
}));
const socketOn = vi.fn();
vi.mock('@/services/socket', () => ({
  default: {
    onCharacterHpUpdated: vi.fn(), onDmTransferred: vi.fn(), onMemberRoleChanged: vi.fn(),
    on: (...a: unknown[]) => socketOn(...a), off: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), getSocket: vi.fn().mockReturnValue(null), startHeartbeat: vi.fn(),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));

import { CampaignProvider, useCampaign } from '../CampaignContext';
import { useGameStore } from '@/stores/gameStore';
import { CampaignStatus, type Campaign, type Map as CampaignMap, type Token } from '@/types';

const campaignAs = (status: string, currentMapId: string, role: string) => ({
  id: 'c1', name: 'Test', status, currentMapId, maps: [], memberships: [{ userId: 'me', role }],
});

let latest: ReturnType<typeof useCampaign> | null = null;
function Probe() {
  latest = useCampaign();
  return null;
}

beforeEach(() => {
  latest = null;
  getCampaign.mockReset();
  getMap.mockReset();
  socketOn.mockReset();
  getMap.mockImplementation((_c: string, mapId: string) => Promise.resolve({ map: { id: mapId, tokens: [] }, spiritVisible: false }));
});

it('picks up the session state, the role and the map the table is now on', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  render(
    <MemoryRouter initialEntries={['/campaigns/c1']}>
      <Routes>
        <Route path="/campaigns/:id" element={<CampaignProvider><Probe /></CampaignProvider>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  // While the page was offline: the session was paused, the member made a
  // spectator, and the table moved to another map.
  getCampaign.mockResolvedValueOnce(campaignAs('PAUSED', 'm2', 'SPECTATOR'));
  await act(async () => { await latest!.catchUpAfterReconnect(); });

  expect(latest!.campaign?.status).toBe('PAUSED');
  expect(latest!.userRole).toBe('SPECTATOR');
  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(getMap).toHaveBeenLastCalledWith('c1', 'm2');
});

// Someone joining the campaign is announced as roster.updated. The page's
// member list, which Duplicate and every role check read, followed only a
// full load, so a token duplicated after a player joined lost its controller.
it('refreshes the member list when the roster changes', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  render(
    <MemoryRouter initialEntries={['/campaigns/c1']}>
      <Routes>
        <Route path="/campaigns/:id" element={<CampaignProvider><Probe /></CampaignProvider>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));
  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  expect(onRoster).toBeDefined();

  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    memberships: [{ userId: 'me', role: 'DM' }, { userId: 'newcomer', role: 'PLAYER' }],
  });
  await act(async () => { onRoster!({ action: 'member.joined', campaignId: 'c1', userId: 'newcomer' }); });
  await waitFor(() => expect(latest!.campaign?.memberships?.map((m) => m.userId)).toEqual(['me', 'newcomer']));
});

// A character brought into the campaign is announced the same way. The
// campaign's character list decides which tokens offer View Character Sheet
// and Roll..., so it follows too.
it('refreshes the character list when a character is brought in', async () => {
  getCampaign.mockResolvedValueOnce({ ...campaignAs('ACTIVE', 'm1', 'DM'), characters: [] });
  render(
    <MemoryRouter initialEntries={['/campaigns/c1']}>
      <Routes>
        <Route path="/campaigns/:id" element={<CampaignProvider><Probe /></CampaignProvider>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));
  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;

  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    characters: [{ id: 'char-new', userId: 'newcomer', name: 'Aldra' }],
  });
  await act(async () => { onRoster!({ action: 'character.assigned', campaignId: 'c1', characterId: 'char-new', userId: 'newcomer' }); });
  await waitFor(() => expect(latest!.campaign?.characters?.map((c) => c.id)).toEqual(['char-new']));
});

// Taking a character out of the campaign is announced the same way. The
// roster's character list decides which tokens offer View Character Sheet
// and Roll..., so an unassign with campaignId must drop that character.
it('refreshes the character list when a character is taken out', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    characters: [{ id: 'char-old', userId: 'me', name: 'Harvey' }],
  });
  render(
    <MemoryRouter initialEntries={['/campaigns/c1']}>
      <Routes>
        <Route path="/campaigns/:id" element={<CampaignProvider><Probe /></CampaignProvider>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(latest?.campaign?.characters?.map((c) => c.id)).toEqual(['char-old']));
  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  expect(onRoster).toBeDefined();

  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    characters: [],
  });
  await act(async () => { onRoster!({ action: 'character.unassigned', campaignId: 'c1', characterId: 'char-old', userId: 'me' }); });
  await waitFor(() => expect(latest!.campaign?.characters?.map((c) => c.id)).toEqual([]));
});

// An unassign that omitted campaignId used to leave the roster stale: the
// handler refuses to refetch without it, so the character stayed listed.
it('leaves the character list unchanged when an unassign has no campaignId', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    characters: [{ id: 'char-old', userId: 'me', name: 'Harvey' }],
  });
  render(
    <MemoryRouter initialEntries={['/campaigns/c1']}>
      <Routes>
        <Route path="/campaigns/:id" element={<CampaignProvider><Probe /></CampaignProvider>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(latest?.campaign?.characters?.map((c) => c.id)).toEqual(['char-old']));
  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  expect(onRoster).toBeDefined();

  expect(getCampaign).toHaveBeenCalledTimes(1);
  await act(async () => { onRoster!({ action: 'character.unassigned', characterId: 'char-old', userId: 'me' }); });
  expect(getCampaign).toHaveBeenCalledTimes(1);
  expect(latest!.campaign?.characters?.map((c) => c.id)).toEqual(['char-old']);
});


// A catch-up still waiting on the server when the page moves to another
// campaign wrote the first campaign's map, tokens and session over the new
// one's when its answers arrived.
it('writes nothing once the page has moved to another campaign', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  render(
    <MemoryRouter initialEntries={['/campaigns/c1']}>
      <Routes>
        <Route path="/campaigns/:id" element={<CampaignProvider><Probe /></CampaignProvider>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  // The catch-up for c1: its campaign read answers, its map read is held.
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  let releaseMap: () => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve) => {
    releaseMap = () => resolve({ map: { id: mapId, tokens: [] }, spiritVisible: false });
  }));
  let catching: Promise<boolean> = Promise.resolve(false);
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getMap).toHaveBeenLastCalledWith('c1', 'm1'));

  // The page moves to c2 meanwhile.
  getCampaign.mockResolvedValueOnce({ ...campaignAs('ACTIVE', 'mB', 'PLAYER'), id: 'c2' });
  await act(async () => { await latest!.loadCampaign('c2'); });
  await waitFor(() => expect(latest?.currentMap?.id).toBe('mB'));

  await act(async () => { releaseMap(); await catching; });
  expect(latest!.campaign?.id).toBe('c2');
  expect(latest!.currentMap?.id).toBe('mB');
});

// The app reaches another campaign through the dashboard, which unmounts this
// provider; the next campaign's page reads the same token store. A catch-up
// still waiting when the page closed wrote its campaign's tokens into it.
it('writes nothing once the page has closed', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  const view = render(
    <MemoryRouter initialEntries={['/campaigns/c1']}>
      <Routes>
        <Route path="/campaigns/:id" element={<CampaignProvider><Probe /></CampaignProvider>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  let releaseMap: () => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve) => {
    releaseMap = () => resolve({ map: { id: mapId, tokens: [{ id: 'from-c1' }] }, spiritVisible: false });
  }));
  let catching: Promise<boolean> = Promise.resolve(false);
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getMap).toHaveBeenLastCalledWith('c1', 'm1'));

  // Back to the dashboard, and into another campaign, whose page loads its own tokens.
  view.unmount();
  act(() => { useGameStore.getState().setTokens([{ id: 'from-c2' } as Token]); });

  await act(async () => { releaseMap(); await catching; });
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-c2']);
});

const renderCampaign = () => render(
  <MemoryRouter initialEntries={['/campaigns/c1']}>
    <Routes>
      <Route path="/campaigns/:id" element={<CampaignProvider><Probe /></CampaignProvider>} />
    </Routes>
  </MemoryRouter>
);

const tokenAt = (id: string, x: number, y: number) => ({ id, position: { x, y } }) as Token;

it('discards a slow getCampaign after the page has switched campaign', async () => {
  let releaseC1: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseC1 = resolve;
  }));
  renderCampaign();
  await waitFor(() => expect(getCampaign).toHaveBeenCalled());

  getCampaign.mockResolvedValueOnce({ ...campaignAs('ACTIVE', 'mB', 'PLAYER'), id: 'c2' });
  await waitFor(() => expect(latest).not.toBeNull());
  await act(async () => { await latest!.loadCampaign('c2'); });
  await waitFor(() => expect(latest?.currentMap?.id).toBe('mB'));

  await act(async () => { releaseC1(campaignAs('ACTIVE', 'm1', 'PLAYER')); });
  expect(latest!.campaign?.id).toBe('c2');
  expect(latest!.currentMap?.id).toBe('mB');
});

it('discards a slow getMap after a generation bump', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  let releaseMap: () => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve) => {
    releaseMap = () => resolve({ map: { id: mapId, tokens: [tokenAt('stale', 1, 2)] }, spiritVisible: false });
  }));
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));

  getCampaign.mockResolvedValueOnce({ ...campaignAs('ACTIVE', 'mB', 'PLAYER'), id: 'c2' });
  await act(async () => { await latest!.loadCampaign('c2'); });
  await waitFor(() => expect(latest?.currentMap?.id).toBe('mB'));

  await act(async () => { releaseMap(); });
  expect(latest!.campaign?.id).toBe('c2');
  expect(latest!.currentMap?.id).toBe('mB');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual([]);
});

it('treats a failed getMap on load as an error and does not empty tokens', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  let failMap: (err: unknown) => void = () => {};
  getMap.mockImplementationOnce(() => new Promise((_resolve, reject) => {
    failMap = reject;
  }));
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));

  act(() => { useGameStore.getState().setTokens([tokenAt('keep-me', 12, 24)]); });
  await act(async () => {
    failMap(Object.assign(new Error('map down'), { response: { status: 500, data: { message: 'Map unavailable' } } }));
  });

  expect(latest!.mapLoadError).toEqual({ mapId: 'm1', message: 'Map unavailable' });
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['keep-me']);
  expect(useGameStore.getState().tokens['keep-me']?.position).toEqual({ x: 12, y: 24 });
  expect(latest!.loading).toBe(false);
});

it('refreshCampaign patches the document without setting loading or rewriting tokens', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('t1', 40, 80)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(useGameStore.getState().tokens['t1']?.position).toEqual({ x: 40, y: 80 });

  let releaseRefresh: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRefresh = resolve;
  }));
  let refreshing: Promise<void> = Promise.resolve();
  act(() => { refreshing = latest!.refreshCampaign(); });
  expect(latest!.loading).toBe(false);

  await act(async () => {
    releaseRefresh({ ...campaignAs('ACTIVE', 'm1', 'PLAYER'), name: 'Renamed Keep' });
    await refreshing;
  });

  expect(latest!.loading).toBe(false);
  expect(latest!.campaign?.name).toBe('Renamed Keep');
  expect(useGameStore.getState().tokens['t1']?.position).toEqual({ x: 40, y: 80 });
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['t1']);
});

it('applies a settings PUT document without setting loading or calling setTokens', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('t1', 7, 9)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  await act(async () => {
    await latest!.refreshCampaign({
      ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
      name: 'From PUT',
      description: 'Updated blurb',
      chatCooldownEnabled: true,
      chatCooldownSeconds: 12,
    } as unknown as Campaign);
  });

  expect(latest!.loading).toBe(false);
  expect(latest!.campaign?.name).toBe('From PUT');
  expect(latest!.campaign?.description).toBe('Updated blurb');
  expect(latest!.campaign?.chatCooldownEnabled).toBe(true);
  expect(latest!.campaign?.chatCooldownSeconds).toBe(12);
  expect(useGameStore.getState().tokens['t1']?.position).toEqual({ x: 7, y: 9 });
});

it('keeps existing tokens when catch-up fails', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('t1', 5, 9)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  getCampaign.mockRejectedValueOnce(
    Object.assign(new Error('catch-up failed'), { response: { status: 503, data: { message: 'Table busy' } } }),
  );
  await act(async () => { await latest!.catchUpAfterReconnect(); });

  expect(latest!.syncError).toBe('Table busy');
  expect(latest!.loading).toBe(false);
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['t1']);
  expect(useGameStore.getState().tokens['t1']?.position).toEqual({ x: 5, y: 9 });
});

it('discards a late first getMap after the table has already switched maps', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  let releaseMap: () => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve) => {
    releaseMap = () => resolve({ map: { id: mapId, tokens: [tokenAt('stale', 1, 2)] }, spiritVisible: false });
  }));
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));

  act(() => {
    latest!.setCurrentMap({ id: 'm2', tokens: [tokenAt('live', 9, 9)] } as unknown as CampaignMap);
    useGameStore.getState().setTokens([tokenAt('live', 9, 9)]);
  });
  await act(async () => { releaseMap(); });

  expect(latest!.currentMap?.id).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['live']);
  expect(useGameStore.getState().tokens['live']?.position).toEqual({ x: 9, y: 9 });
});

it('clears a first-map error when catch-up hydrates the map', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockRejectedValueOnce(
    Object.assign(new Error('down'), { response: { status: 500, data: { message: 'Map unavailable' } } }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.mapLoadError).toEqual({ mapId: 'm1', message: 'Map unavailable' }));

  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockResolvedValueOnce({ map: { id: 'm1', tokens: [tokenAt('t1', 1, 1)] }, spiritVisible: false });
  await act(async () => { await latest!.catchUpAfterReconnect(); });

  expect(latest!.mapLoadError).toBeNull();
  expect(latest!.syncError).toBeNull();
  expect(useGameStore.getState().tokens['t1']?.position).toEqual({ x: 1, y: 1 });
});

it('sets a non-retryable 403 during catch-up without emptying tokens or navigating away', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('t1', 3, 4)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  getCampaign.mockRejectedValueOnce(
    Object.assign(new Error('Forbidden'), { response: { status: 403, data: { message: 'Removed' } } }),
  );
  await act(async () => { await latest!.catchUpAfterReconnect(); });

  expect(latest!.error).toBe('You do not have permission to view this campaign');
  expect(latest!.errorRetryable).toBe(false);
  expect(latest!.campaign?.id).toBe('c1');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['t1']);

  vi.useFakeTimers();
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(latest!.error).toBe('You do not have permission to view this campaign');
    expect(latest!.errorRetryable).toBe(false);
    expect(latest!.campaign?.id).toBe('c1');
    expect(latest!.currentMap?.id).toBe('m1');
  } finally {
    vi.useRealTimers();
  }
});

it('does not rewind currentMapId when catch-up GET is stale after a live map switch', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('t1', 1, 1)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  let releaseCampaign: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCampaign = resolve;
  }));
  let catching: Promise<boolean> = Promise.resolve(false);
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    latest!.setCurrentMap({ id: 'm2', tokens: [tokenAt('live', 9, 9)] } as unknown as CampaignMap);
    useGameStore.getState().setTokens([tokenAt('live', 9, 9)]);
  });

  await act(async () => {
    releaseCampaign(campaignAs('ACTIVE', 'm3', 'PLAYER'));
    await catching;
  });

  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(latest!.currentMap?.id).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['live']);
  expect(useGameStore.getState().tokens['live']?.position).toEqual({ x: 9, y: 9 });
  expect(getMap.mock.calls.some(([, mapId]) => mapId === 'm3')).toBe(false);
});

it('discards a late catch-up getMap after the table has already switched maps', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('t1', 1, 1)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm3', 'PLAYER'));
  let releaseMap: () => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve) => {
    releaseMap = () => resolve({ map: { id: mapId, tokens: [tokenAt('stale', 1, 2)] }, spiritVisible: false });
  }));
  let catching: Promise<boolean> = Promise.resolve(false);
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getMap).toHaveBeenLastCalledWith('c1', 'm3'));

  act(() => {
    latest!.setCurrentMap({ id: 'm2', tokens: [tokenAt('live', 9, 9)] } as unknown as CampaignMap);
    useGameStore.getState().setTokens([tokenAt('live', 9, 9)]);
  });
  await act(async () => { releaseMap(); await catching; });

  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(latest!.currentMap?.id).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['live']);
});

it('clears the mounted map when catch-up GET has no current map and the live map did not move on', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('t1', 1, 1)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  getCampaign.mockResolvedValueOnce({ ...campaignAs('ACTIVE', 'm1', 'PLAYER'), currentMapId: null });
  await act(async () => { await latest!.catchUpAfterReconnect(); });

  expect(latest!.currentMap).toBeNull();
  expect(latest!.campaign?.currentMapId).toBeNull();
  expect(Object.keys(useGameStore.getState().tokens)).toEqual([]);
  expect(latest!.syncError).toBeNull();
  expect(latest!.mapLoadError).toBeNull();
});

it('does not clear the live map when catch-up GET has no current map after a live switch', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('t1', 1, 1)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  let releaseCampaign: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCampaign = resolve;
  }));
  let catching: Promise<boolean> = Promise.resolve(false);
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    latest!.setCurrentMap({ id: 'm2', tokens: [tokenAt('live', 9, 9)] } as unknown as CampaignMap);
    useGameStore.getState().setTokens([tokenAt('live', 9, 9)]);
  });
  await act(async () => {
    releaseCampaign({ ...campaignAs('ACTIVE', 'm1', 'PLAYER'), currentMapId: null });
    await catching;
  });

  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['live']);
});

it('refreshCampaign settings PUT does not overwrite live map, status, or spirit', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    spiritLayerEnabled: false,
  });
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('t1', 4, 5)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  act(() => {
    latest!.setCurrentMap({ id: 'm2', tokens: [tokenAt('t1', 4, 5)] } as unknown as CampaignMap);
    latest!.updateCampaignSpiritLayer(true);
    latest!.updateCampaignStatus(CampaignStatus.PAUSED);
    latest!.updateVibe('night', '#112233', 'brightness(0.6)');
  });

  await act(async () => {
    await latest!.refreshCampaign({
      ...campaignAs('INACTIVE', 'm1', 'PLAYER'),
      name: 'Settings Name',
      description: 'Settings blurb',
      chatCooldownEnabled: true,
      chatCooldownSeconds: 8,
      spiritLayerEnabled: false,
    } as unknown as Campaign);
  });

  expect(latest!.campaign?.name).toBe('Settings Name');
  expect(latest!.campaign?.description).toBe('Settings blurb');
  expect(latest!.campaign?.chatCooldownEnabled).toBe(true);
  expect(latest!.campaign?.chatCooldownSeconds).toBe(8);
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(latest!.campaign?.spiritLayerEnabled).toBe(true);
  expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED);
  expect(latest!.campaign?.currentVibe).toBe('night');
  expect(useGameStore.getState().tokens['t1']?.position).toEqual({ x: 4, y: 5 });
});
