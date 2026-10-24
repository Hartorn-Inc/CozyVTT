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
    onCharacterHpUpdated: vi.fn(),
    onDmTransferred: (cb: unknown) => socketOn('campaign.dm.transferred', cb),
    onMemberRoleChanged: (cb: unknown) => socketOn('campaign.role.changed', cb),
    on: (...a: unknown[]) => socketOn(...a), off: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), getSocket: vi.fn().mockReturnValue(null), startHeartbeat: vi.fn(),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));

import { CampaignProvider, useCampaign, type TableRetryOutcome } from '../CampaignContext';
import { useGameStore } from '@/stores/gameStore';
import { CampaignStatus, TokenLayer, type Campaign, type Map as CampaignMap, type Token } from '@/types';

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
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
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
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
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
  getMap.mockResolvedValueOnce({
    map: { id: 'm1', tokens: [tokenAt('t1', 40, 80)] },
    spiritVisible: false,
  });
  let refreshing: Promise<boolean> = Promise.resolve(false);
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
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
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
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
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
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
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
    latest!.setActiveSession({ id: 'live-sess', sessionNumber: 4, startedAt: '2026-01-01T00:00:00.000Z' });
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
      activeSession: { id: 'put-sess', sessionNumber: 9, startedAt: '2026-02-01T00:00:00.000Z' },
    } as unknown as Campaign);
  });

  expect(latest!.campaign?.name).toBe('Settings Name');
  expect(latest!.campaign?.description).toBe('Settings blurb');
  expect(latest!.campaign?.chatCooldownEnabled).toBe(true);
  expect(latest!.campaign?.chatCooldownSeconds).toBe(8);
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(latest!.campaign?.spiritLayerEnabled).toBe(true);
  expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED);
  expect(latest!.activeSession?.id).toBe('live-sess');
  expect(latest!.campaign?.currentVibe).toBe('night');
  expect(useGameStore.getState().tokens['t1']?.position).toEqual({ x: 4, y: 5 });
});

it('does not adopt a stale catch-up map after a live A→B→A round trip', async () => {
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
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    latest!.setCurrentMap({ id: 'm2', tokens: [tokenAt('mid', 2, 2)] } as unknown as CampaignMap);
    useGameStore.getState().setTokens([tokenAt('mid', 2, 2)]);
  });
  act(() => {
    latest!.setCurrentMap({ id: 'm1', tokens: [tokenAt('back', 3, 3)] } as unknown as CampaignMap);
    useGameStore.getState().setTokens([tokenAt('back', 3, 3)]);
  });

  const getMapCallsBeforeRelease = getMap.mock.calls.length;
  await act(async () => {
    releaseCampaign(campaignAs('ACTIVE', 'm2', 'PLAYER'));
    await catching;
  });

  expect(latest!.currentMap?.id).toBe('m1');
  expect(latest!.campaign?.currentMapId).toBe('m1');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['back']);
  expect(getMap.mock.calls.slice(getMapCallsBeforeRelease).some(([, mapId]) => mapId === 'm2')).toBe(false);
});

it('does not clear the mounted map when catch-up GET is null after a live A→B→A round trip', async () => {
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
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    latest!.setCurrentMap({ id: 'm2', tokens: [tokenAt('mid', 2, 2)] } as unknown as CampaignMap);
    useGameStore.getState().setTokens([tokenAt('mid', 2, 2)]);
  });
  act(() => {
    latest!.setCurrentMap({ id: 'm1', tokens: [tokenAt('back', 3, 3)] } as unknown as CampaignMap);
    useGameStore.getState().setTokens([tokenAt('back', 3, 3)]);
  });

  await act(async () => {
    releaseCampaign({ ...campaignAs('ACTIVE', 'm2', 'PLAYER'), currentMapId: null });
    await catching;
  });

  expect(latest!.currentMap?.id).toBe('m1');
  expect(latest!.campaign?.currentMapId).toBe('m1');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['back']);
});

it('still hydrates catch-up when a same-id function-form patch runs while GET is in flight', async () => {
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
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    latest!.setCurrentMap((prev) => (prev?.id === 'm1' ? { ...prev, fogEnabled: true } : prev));
  });

  await act(async () => {
    releaseCampaign(campaignAs('ACTIVE', 'm2', 'PLAYER'));
    await catching;
  });

  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(getMap.mock.calls.some(([, mapId]) => mapId === 'm2')).toBe(true);
});

it('does not roll back a live pause or role from a stale catch-up GET, including when the map half is discarded', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('t1', 1, 1)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.campaign?.status).toBe('ACTIVE');
  expect(latest!.userRole).toBe('PLAYER');

  const onRoleChanged = socketOn.mock.calls
    .filter(([event]) => event === 'campaign.role.changed')
    .pop()?.[1] as ((d: { campaignId: string; userId: string; role: string }) => void) | undefined;
  expect(onRoleChanged).toBeDefined();

  let releaseCampaign: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCampaign = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    latest!.updateCampaignStatus(CampaignStatus.PAUSED);
    onRoleChanged!({ campaignId: 'c1', userId: 'me', role: 'SPECTATOR' });
    latest!.setCurrentMap({ id: 'm2', tokens: [tokenAt('live', 9, 9)] } as unknown as CampaignMap);
    useGameStore.getState().setTokens([tokenAt('live', 9, 9)]);
    latest!.setCurrentMap({ id: 'm1', tokens: [tokenAt('back', 3, 3)] } as unknown as CampaignMap);
    useGameStore.getState().setTokens([tokenAt('back', 3, 3)]);
  });

  await act(async () => {
    releaseCampaign(campaignAs('ACTIVE', 'm2', 'PLAYER'));
    await catching;
  });

  expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED);
  expect(latest!.userRole).toBe('SPECTATOR');
  expect(latest!.currentMap?.id).toBe('m1');
  expect(latest!.campaign?.currentMapId).toBe('m1');
  expect(getMap.mock.calls.some(([, mapId]) => mapId === 'm2')).toBe(false);
});

it('still applies a missed pause when reconnect authenticated repeats the same role', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('t1', 1, 1)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  const onAuthenticated = socketOn.mock.calls
    .filter(([event]) => event === 'authenticated')
    .pop()?.[1] as ((d: { campaignId: string; userId: string; role: string }) => void) | undefined;
  expect(onAuthenticated).toBeDefined();

  let releaseCampaign: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCampaign = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    onAuthenticated!({ campaignId: 'c1', userId: 'me', role: 'PLAYER' });
  });

  await act(async () => {
    releaseCampaign(campaignAs('PAUSED', 'm1', 'PLAYER'));
    await catching;
  });

  expect(latest!.campaign?.status).toBe('PAUSED');
  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.currentMap?.id).toBe('m1');
});

it('does not apply an older getMap after catch-up adopted a different map', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  let releaseA: () => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve) => {
    releaseA = () => resolve({ map: { id: mapId, tokens: [tokenAt('from-a', 1, 1)] }, spiritVisible: false });
  }));
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));
  await waitFor(() => expect(getMap).toHaveBeenCalledWith('c1', 'm1'));

  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm2', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('from-b', 2, 2)] }, spiritVisible: false }),
  );
  await act(async () => { await latest!.catchUpAfterReconnect(); });

  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');

  await act(async () => { releaseA(); });

  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-b']);
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('from-a');
});

it('does not apply an older catch-up after a newer catch-up adopted a different map', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  let releaseOlder: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseOlder = resolve;
  }));
  let older: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { older = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm2', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('from-b', 2, 2)] }, spiritVisible: false }),
  );
  await act(async () => { await latest!.catchUpAfterReconnect(); });
  expect(latest!.currentMap?.id).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-b']);

  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('from-a', 1, 1)] }, spiritVisible: false }),
  );
  let olderResult: TableRetryOutcome | undefined;
  await act(async () => {
    releaseOlder(campaignAs('ACTIVE', 'm1', 'PLAYER'));
    olderResult = await older;
  });

  expect(olderResult).toEqual({ discarded: true });
  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-b']);
});

it('does not apply a refreshCurrentMap started on A after catch-up adopted B', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  let releaseA: () => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve) => {
    releaseA = () => resolve({ map: { id: mapId, tokens: [tokenAt('from-a', 1, 1)] }, spiritVisible: false });
  }));
  act(() => { void latest!.refreshCurrentMap(); });
  await waitFor(() => expect(getMap).toHaveBeenCalledTimes(2));

  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm2', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('from-b', 2, 2)] }, spiritVisible: false }),
  );
  await act(async () => { await latest!.catchUpAfterReconnect(); });
  expect(latest!.currentMap?.id).toBe('m2');

  await act(async () => { releaseA(); });

  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-b']);
});

it('does not apply an older getMap after catch-up cleared the table', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  let releaseA: () => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve) => {
    releaseA = () => resolve({ map: { id: mapId, tokens: [tokenAt('from-a', 1, 1)] }, spiritVisible: false });
  }));
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));
  await waitFor(() => expect(getMap).toHaveBeenCalledWith('c1', 'm1'));

  getCampaign.mockResolvedValueOnce({ ...campaignAs('ACTIVE', 'm1', 'PLAYER'), currentMapId: null });
  await act(async () => { await latest!.catchUpAfterReconnect(); });

  expect(latest!.currentMap).toBeNull();
  expect(latest!.campaign?.currentMapId).toBeNull();

  await act(async () => { releaseA(); });

  expect(latest!.currentMap).toBeNull();
  expect(latest!.currentMap?.id).not.toBe('m1');
  expect(latest!.campaign?.currentMapId).toBeNull();
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('from-a');
});

it('does not apply a DM map body after the session role drops to PLAYER', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({
      map: {
        id: mapId,
        tokens: [tokenAt('visible', 1, 1), { id: 'spirit-1', layer: TokenLayer.SPIRIT } as Token],
        spiritLayerUrl: 'https://example/spirit-initial.png',
      },
      spiritVisible: true,
    }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.userRole).toBe('DM');

  const onRoleChanged = socketOn.mock.calls
    .filter(([event]) => event === 'campaign.role.changed')
    .pop()?.[1] as ((d: { campaignId: string; userId: string; role: string }) => void) | undefined;
  expect(onRoleChanged).toBeDefined();

  let releaseMap: () => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve) => {
    releaseMap = () => resolve({
      map: {
        id: mapId,
        tokens: [tokenAt('visible', 1, 1), { id: 'spirit-1', layer: TokenLayer.SPIRIT } as Token],
        spiritLayerUrl: 'https://example/spirit-dm.png',
        spiritVisible: true,
      },
      spiritVisible: true,
    });
  }));
  act(() => { void latest!.refreshCurrentMap(); });
  await waitFor(() => expect(getMap).toHaveBeenCalledTimes(2));

  act(() => {
    onRoleChanged!({ campaignId: 'c1', userId: 'me', role: 'PLAYER' });
    latest!.setPlayerSpiritVisible(false);
    useGameStore.getState().setTokens([tokenAt('visible', 1, 1)]);
  });
  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.playerSpiritVisible).toBe(false);

  await act(async () => { releaseMap(); });

  expect(latest!.playerSpiritVisible).toBe(false);
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('spirit-1');
  expect(latest!.currentMap?.spiritLayerUrl).not.toBe('https://example/spirit-dm.png');
});

it('does not apply a DM catch-up getMap after the session role drops to PLAYER', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({
      map: {
        id: mapId,
        tokens: [tokenAt('visible', 1, 1)],
        spiritLayerUrl: 'https://example/spirit-player.png',
      },
      spiritVisible: false,
    }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  const onRoleChanged = socketOn.mock.calls
    .filter(([event]) => event === 'campaign.role.changed')
    .pop()?.[1] as ((d: { campaignId: string; userId: string; role: string }) => void) | undefined;
  expect(onRoleChanged).toBeDefined();

  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  let releaseMap: () => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve) => {
    releaseMap = () => resolve({
      map: {
        id: mapId,
        tokens: [tokenAt('visible', 1, 1), { id: 'spirit-1', layer: TokenLayer.SPIRIT } as Token],
        spiritLayerUrl: 'https://example/spirit-dm.png',
        spiritVisible: true,
      },
      spiritVisible: true,
    });
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getMap).toHaveBeenCalledTimes(2));

  act(() => {
    onRoleChanged!({ campaignId: 'c1', userId: 'me', role: 'PLAYER' });
    latest!.setPlayerSpiritVisible(false);
    useGameStore.getState().setTokens([tokenAt('visible', 1, 1)]);
  });
  expect(latest!.userRole).toBe('PLAYER');

  let catchUpResult: TableRetryOutcome | undefined;
  await act(async () => {
    releaseMap();
    catchUpResult = await catching;
  });

  expect(catchUpResult).toEqual({ discarded: true });
  expect(latest!.syncError).not.toBe('Failed to refresh the current map');
  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.playerSpiritVisible).toBe(false);
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('spirit-1');
  expect(latest!.currentMap?.spiritLayerUrl).not.toBe('https://example/spirit-dm.png');
});

it('does not restore DM from a stale roster GET after a live role drop', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  renderCampaign();
  await waitFor(() => expect(latest?.userRole).toBe('DM'));

  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  const onRoleChanged = socketOn.mock.calls
    .filter(([event]) => event === 'campaign.role.changed')
    .pop()?.[1] as ((d: { campaignId: string; userId: string; role: string }) => void) | undefined;
  expect(onRoster).toBeDefined();
  expect(onRoleChanged).toBeDefined();

  let releaseRoster: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRoster = resolve;
  }));
  await act(async () => { onRoster!({ action: 'member.joined', campaignId: 'c1', userId: 'newcomer' }); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    onRoleChanged!({ campaignId: 'c1', userId: 'me', role: 'SPECTATOR' });
  });
  expect(latest!.userRole).toBe('SPECTATOR');

  await act(async () => {
    releaseRoster({
      ...campaignAs('ACTIVE', 'm1', 'DM'),
      memberships: [{ userId: 'me', role: 'DM' }, { userId: 'newcomer', role: 'PLAYER' }],
      characters: [{ id: 'char-new', userId: 'newcomer', name: 'Aldra' }],
    });
  });

  expect(latest!.userRole).toBe('SPECTATOR');
  expect(latest!.campaign?.characters?.map((c) => c.id)).toEqual(['char-new']);
});

it('does not apply an older roster GET after a newer one', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));
  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  expect(onRoster).toBeDefined();

  let releaseOlder: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseOlder = resolve;
  }));
  await act(async () => { onRoster!({ action: 'member.joined', campaignId: 'c1', userId: 'old' }); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    memberships: [{ userId: 'me', role: 'DM' }, { userId: 'newer', role: 'PLAYER' }],
  });
  await act(async () => { onRoster!({ action: 'member.joined', campaignId: 'c1', userId: 'newer' }); });
  await waitFor(() => expect(latest!.campaign?.memberships?.map((m) => m.userId)).toEqual(['me', 'newer']));

  await act(async () => {
    releaseOlder({
      ...campaignAs('ACTIVE', 'm1', 'DM'),
      memberships: [{ userId: 'me', role: 'DM' }, { userId: 'old', role: 'PLAYER' }],
    });
  });

  expect(latest!.campaign?.memberships?.map((m) => m.userId)).toEqual(['me', 'newer']);
});

it('refreshCampaign does not restore memberships after a live role drop', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  renderCampaign();
  await waitFor(() => expect(latest?.userRole).toBe('DM'));

  const onRoleChanged = socketOn.mock.calls
    .filter(([event]) => event === 'campaign.role.changed')
    .pop()?.[1] as ((d: { campaignId: string; userId: string; role: string }) => void) | undefined;
  expect(onRoleChanged).toBeDefined();

  let releaseRefresh: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRefresh = resolve;
  }));
  let refreshing: Promise<boolean> = Promise.resolve(false);
  act(() => { refreshing = latest!.refreshCampaign(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    onRoleChanged!({ campaignId: 'c1', userId: 'me', role: 'SPECTATOR' });
  });
  expect(latest!.userRole).toBe('SPECTATOR');

  await act(async () => {
    releaseRefresh({
      ...campaignAs('ACTIVE', 'm1', 'DM'),
      name: 'Renamed Keep',
      memberships: [{ userId: 'me', role: 'DM' }],
    });
    await refreshing;
  });

  expect(latest!.userRole).toBe('SPECTATOR');
  expect(latest!.campaign?.name).toBe('Renamed Keep');
});

it('does not abort in-flight catch-up when retryMapLoad starts', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockRejectedValueOnce(
    Object.assign(new Error('down'), { response: { status: 500, data: { message: 'Map unavailable' } } }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.mapLoadError).toEqual({ mapId: 'm1', message: 'Map unavailable' }));

  let releaseCatchUp: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCatchUp = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => { void latest!.retryMapLoad(); });

  let catchUpResult: TableRetryOutcome | undefined;
  await act(async () => {
    releaseCatchUp(campaignAs('PAUSED', 'm1', 'PLAYER'));
    catchUpResult = await catching;
  });

  expect(latest!.campaign?.status).toBe('PAUSED');
  expect(latest!.userRole).toBe('PLAYER');
  // Retry map load is a same-map read. Catch-up bumps mapReadSeq after GET
  // before its getMap, so it can hydrate rather than discard.
  expect(catchUpResult).toEqual({ ok: true, message: 'Table synced' });
});

it('returns discarded from retryMapLoad when the live map id changed and leaves banners unchanged', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockRejectedValueOnce(
    Object.assign(new Error('down'), { response: { status: 500, data: { message: 'Map unavailable' } } }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.mapLoadError).toEqual({ mapId: 'm1', message: 'Map unavailable' }));

  getCampaign.mockRejectedValueOnce(
    Object.assign(new Error('catch-up failed'), { response: { status: 503, data: { message: 'Table busy' } } }),
  );
  await act(async () => { await latest!.catchUpAfterReconnect(); });
  expect(latest!.syncError).toBe('Table busy');

  let releaseMap: () => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve) => {
    releaseMap = () => resolve({ map: { id: mapId, tokens: [tokenAt('stale', 1, 2)] }, spiritVisible: false });
  }));
  let retryResult: TableRetryOutcome | undefined;
  act(() => { void latest!.retryMapLoad().then((result) => { retryResult = result; }); });
  await waitFor(() => expect(getMap).toHaveBeenCalled());

  act(() => {
    latest!.setCurrentMap({ id: 'm2', tokens: [tokenAt('live', 9, 9)] } as unknown as CampaignMap);
    useGameStore.getState().setTokens([tokenAt('live', 9, 9)]);
  });
  const mapLoadErrorAfterSwitch = latest!.mapLoadError;
  const syncErrorAfterSwitch = latest!.syncError;

  await act(async () => { releaseMap(); });
  await waitFor(() => expect(retryResult).toEqual({ discarded: true }));

  expect(latest!.mapLoadError).toEqual(mapLoadErrorAfterSwitch);
  expect(latest!.syncError).toBe(syncErrorAfterSwitch);
  expect(latest!.syncError).toBe('Table busy');
  expect(latest!.currentMap?.id).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['live']);
});

it('does not restore an older catch-up campaign row after a newer catch-up', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  let releaseOlder: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseOlder = resolve;
  }));
  let older: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { older = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  getCampaign.mockResolvedValueOnce({
    ...campaignAs('PAUSED', 'm2', 'SPECTATOR'),
    memberships: [{ userId: 'me', role: 'SPECTATOR' }, { userId: 'newcomer', role: 'PLAYER' }],
  });
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('from-b', 2, 2)] }, spiritVisible: false }),
  );
  await act(async () => { await latest!.catchUpAfterReconnect(); });
  expect(latest!.campaign?.status).toBe('PAUSED');
  expect(latest!.userRole).toBe('SPECTATOR');
  expect(latest!.campaign?.memberships?.map((m) => m.userId)).toEqual(['me', 'newcomer']);
  expect(latest!.currentMap?.id).toBe('m2');

  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('from-a', 1, 1)] }, spiritVisible: false }),
  );
  let olderResult: TableRetryOutcome | undefined;
  await act(async () => {
    releaseOlder({
      ...campaignAs('ACTIVE', 'm1', 'DM'),
      memberships: [{ userId: 'me', role: 'DM' }],
      activeSession: null,
    });
    olderResult = await older;
  });

  expect(olderResult).toEqual({ discarded: true });
  expect(latest!.campaign?.status).toBe('PAUSED');
  expect(latest!.userRole).toBe('SPECTATOR');
  expect(latest!.campaign?.memberships?.map((m) => m.userId)).toEqual(['me', 'newcomer']);
  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-b']);
});

it('does not surface an older catch-up failure after a newer catch-up succeeds', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  let rejectOlder: (err: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((_resolve, reject) => {
    rejectOlder = reject;
  }));
  let older: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { older = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  getCampaign.mockResolvedValueOnce(campaignAs('PAUSED', 'm1', 'PLAYER'));
  await act(async () => { await latest!.catchUpAfterReconnect(); });
  expect(latest!.campaign?.status).toBe('PAUSED');
  expect(latest!.syncError).toBeNull();
  expect(latest!.error).toBeNull();

  let olderResult: TableRetryOutcome | undefined;
  await act(async () => {
    rejectOlder(Object.assign(new Error('catch-up failed'), { response: { status: 503, data: { message: 'Table busy' } } }));
    olderResult = await older;
  });

  expect(olderResult).toEqual({ discarded: true });
  expect(latest!.syncError).toBeNull();
  expect(latest!.error).toBeNull();
  expect(latest!.campaign?.status).toBe('PAUSED');
});

it('does not surface an older catch-up 403 after a newer catch-up succeeds', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  let rejectOlder: (err: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((_resolve, reject) => {
    rejectOlder = reject;
  }));
  let older: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { older = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  getCampaign.mockResolvedValueOnce(campaignAs('PAUSED', 'm1', 'PLAYER'));
  await act(async () => { await latest!.catchUpAfterReconnect(); });
  expect(latest!.campaign?.status).toBe('PAUSED');

  let olderResult: TableRetryOutcome | undefined;
  await act(async () => {
    rejectOlder(Object.assign(new Error('Forbidden'), { response: { status: 403, data: { message: 'Removed' } } }));
    olderResult = await older;
  });

  expect(olderResult).toEqual({ discarded: true });
  expect(latest!.syncError).toBeNull();
  expect(latest!.error).toBeNull();
  expect(latest!.campaign?.status).toBe('PAUSED');
  expect(latest!.campaign?.id).toBe('c1');
});

it('does not let a same-map refresh discard a catch-up that learned a different map', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  let releaseCatchUp: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCatchUp = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  let releaseA: () => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve) => {
    releaseA = () => resolve({ map: { id: mapId, tokens: [tokenAt('from-a', 1, 1)] }, spiritVisible: false });
  }));
  act(() => { void latest!.refreshCurrentMap(); });
  await waitFor(() => expect(getMap).toHaveBeenCalledTimes(2));

  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('from-b', 2, 2)] }, spiritVisible: false }),
  );
  await act(async () => {
    releaseCatchUp(campaignAs('ACTIVE', 'm2', 'PLAYER'));
    await catching;
  });

  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-b']);

  await act(async () => { releaseA(); });

  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-b']);
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('from-a');
});

it('does not restore memberships from an older refreshCampaign GET after a roster update', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    characters: [{ id: 'char-old', userId: 'me', name: 'Harvey' }],
  });
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));
  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  expect(onRoster).toBeDefined();

  let releaseRefresh: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRefresh = resolve;
  }));
  let refreshing: Promise<boolean> = Promise.resolve(false);
  act(() => { refreshing = latest!.refreshCampaign(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    name: 'From roster',
    chatCooldownEnabled: true,
    chatCooldownSeconds: 9,
    memberships: [{ userId: 'me', role: 'DM' }, { userId: 'newcomer', role: 'PLAYER' }],
    characters: [{ id: 'char-new', userId: 'newcomer', name: 'Aldra' }],
  });
  await act(async () => { onRoster!({ action: 'member.joined', campaignId: 'c1', userId: 'newcomer' }); });
  await waitFor(() => expect(latest!.campaign?.memberships?.map((m) => m.userId)).toEqual(['me', 'newcomer']));
  expect(latest!.campaign?.characters?.map((c) => c.id)).toEqual(['char-new']);
  expect(latest!.campaign?.name).toBe('From roster');
  expect(latest!.campaign?.chatCooldownSeconds).toBe(9);

  await act(async () => {
    releaseRefresh({
      ...campaignAs('ACTIVE', 'm1', 'DM'),
      name: 'From refresh',
      chatCooldownEnabled: false,
      chatCooldownSeconds: 3,
      memberships: [{ userId: 'me', role: 'DM' }],
      characters: [{ id: 'char-old', userId: 'me', name: 'Harvey' }],
    });
    await refreshing;
  });

  expect(latest!.campaign?.memberships?.map((m) => m.userId)).toEqual(['me', 'newcomer']);
  expect(latest!.campaign?.characters?.map((c) => c.id)).toEqual(['char-new']);
  expect(latest!.campaign?.name).toBe('From roster');
  expect(latest!.campaign?.chatCooldownEnabled).toBe(true);
  expect(latest!.campaign?.chatCooldownSeconds).toBe(9);
});

it('does not apply a DM load body after demotion while the campaign row is still null', async () => {
  let releaseLoad: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseLoad = resolve;
  }));
  renderCampaign();
  await waitFor(() => expect(getCampaign).toHaveBeenCalled());
  await waitFor(() => expect(latest).not.toBeNull());

  const onAuthenticated = socketOn.mock.calls
    .filter(([event]) => event === 'authenticated')
    .pop()?.[1] as ((d: { campaignId: string; userId: string; role: string }) => void) | undefined;
  expect(onAuthenticated).toBeDefined();

  act(() => {
    onAuthenticated!({ campaignId: 'c1', userId: 'me', role: 'PLAYER' });
  });

  await act(async () => {
    releaseLoad({
      ...campaignAs('ACTIVE', 'm1', 'DM'),
      memberships: [{ userId: 'me', role: 'DM' }, { userId: 'other', role: 'PLAYER' }],
      maps: [{ id: 'other', spiritLayerUrl: 'https://example/spirit-other.png' }],
    });
  });

  await waitFor(() => expect(latest!.campaign?.id).toBe('c1'));
  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.campaign?.maps?.some((m) => m.spiritLayerUrl === 'https://example/spirit-other.png')).toBe(false);
  expect(latest!.campaign?.maps ?? []).toEqual([]);
  expect(getMap).not.toHaveBeenCalled();
  expect(latest!.currentMap).toBeNull();
});

const loadMaps = [{ id: 'keep-map', name: 'The Keep' }];
const loadMemberships = [{ userId: 'me', role: 'DM' }, { userId: 'other', role: 'PLAYER' }];
const getSession = { id: 'sess-get', sessionNumber: 3, startedAt: '2026-01-01T00:00:00.000Z' };

it('keeps GET maps and memberships when a live pause arrives during first load', async () => {
  let releaseLoad: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseLoad = resolve;
  }));
  renderCampaign();
  await waitFor(() => expect(getCampaign).toHaveBeenCalled());
  await waitFor(() => expect(latest).not.toBeNull());

  act(() => {
    latest!.updateCampaignStatus(CampaignStatus.PAUSED);
  });

  await act(async () => {
    releaseLoad({
      ...campaignAs('ACTIVE', 'm1', 'DM'),
      maps: loadMaps,
      memberships: loadMemberships,
      activeSession: getSession,
    });
  });

  await waitFor(() => expect(latest!.campaign?.id).toBe('c1'));
  expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED);
  expect(latest!.campaign?.maps).toEqual(loadMaps);
  expect(latest!.campaign?.memberships?.map((m) => m.userId)).toEqual(['me', 'other']);
  expect(latest!.activeSession).toEqual(getSession);
});

it('keeps a live ended session over a stale GET session after first load', async () => {
  let releaseLoad: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseLoad = resolve;
  }));
  renderCampaign();
  await waitFor(() => expect(getCampaign).toHaveBeenCalled());
  await waitFor(() => expect(latest).not.toBeNull());

  act(() => {
    latest!.updateCampaignStatus(CampaignStatus.INACTIVE);
    latest!.setActiveSession(null);
  });

  await act(async () => {
    releaseLoad({
      ...campaignAs('ACTIVE', 'm1', 'DM'),
      maps: loadMaps,
      memberships: loadMemberships,
      activeSession: getSession,
    });
  });

  await waitFor(() => expect(latest!.campaign?.id).toBe('c1'));
  expect(latest!.campaign?.status).toBe(CampaignStatus.INACTIVE);
  expect(latest!.activeSession).toBeNull();
  expect(latest!.campaign?.maps).toEqual(loadMaps);
  expect(latest!.campaign?.memberships?.map((m) => m.userId)).toEqual(['me', 'other']);
});

it('copies pause and ended session from a roster GET while catch-up is still in flight', async () => {
  const liveSession = { id: 'sess-live', sessionNumber: 2, startedAt: '2026-01-02T00:00:00.000Z' };
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    activeSession: liveSession,
  });
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.campaign?.status).toBe('ACTIVE');
  expect(latest!.activeSession).toEqual(liveSession);

  let releaseCatchUp: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCatchUp = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  expect(onRoster).toBeDefined();

  getCampaign.mockResolvedValueOnce({
    ...campaignAs('PAUSED', 'm1', 'PLAYER'),
    memberships: [{ userId: 'me', role: 'PLAYER' }, { userId: 'newcomer', role: 'PLAYER' }],
    activeSession: null,
  });
  await act(async () => { onRoster!({ action: 'member.joined', campaignId: 'c1', userId: 'newcomer' }); });
  await waitFor(() => expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED));
  expect(latest!.activeSession).toBeNull();
  expect(latest!.campaign?.memberships?.map((m) => m.userId)).toEqual(['me', 'newcomer']);

  let catchUpResult: TableRetryOutcome | undefined;
  await act(async () => {
    releaseCatchUp({
      ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
      activeSession: liveSession,
    });
    catchUpResult = await catching;
  });

  expect(catchUpResult).toEqual({ discarded: true });
  expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED);
  expect(latest!.activeSession).toBeNull();
});

it('sets syncError when a newer roster GET fails and discards the older catch-up', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    activeSession: { id: 'sess-live', sessionNumber: 1, startedAt: '2026-01-01T00:00:00.000Z' },
  });
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  let releaseCatchUp: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCatchUp = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  expect(onRoster).toBeDefined();

  getCampaign.mockRejectedValueOnce(
    Object.assign(new Error('roster failed'), { response: { status: 503, data: { message: 'Table busy' } } }),
  );
  await act(async () => { onRoster!({ action: 'member.joined', campaignId: 'c1', userId: 'newcomer' }); });
  await waitFor(() => expect(latest!.syncError).toBe('Table busy'));

  let catchUpResult: TableRetryOutcome | undefined;
  await act(async () => {
    releaseCatchUp(campaignAs('ACTIVE', 'm1', 'PLAYER'));
    catchUpResult = await catching;
  });

  expect(catchUpResult).toEqual({ discarded: true });
  expect(latest!.syncError).toBe('Table busy');
  expect(latest!.campaign?.status).toBe('ACTIVE');
});

it('copies status and activeSession from a refreshCampaign GET when the session epoch is unchanged', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    activeSession: { id: 'sess-live', sessionNumber: 1, startedAt: '2026-01-01T00:00:00.000Z' },
  });
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  getCampaign.mockResolvedValueOnce({
    ...campaignAs('PAUSED', 'm1', 'PLAYER'),
    name: 'Renamed Keep',
    activeSession: null,
  });
  await act(async () => { await latest!.refreshCampaign(); });

  expect(latest!.campaign?.name).toBe('Renamed Keep');
  expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED);
  expect(latest!.activeSession).toBeNull();
});

it('does not let refreshCurrentMap of A steal a catch-up claim of B', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  let releaseCatchUp: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCatchUp = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  let releaseB: () => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve) => {
    releaseB = () => resolve({ map: { id: mapId, tokens: [tokenAt('from-b', 2, 2)] }, spiritVisible: false });
  }));
  await act(async () => { releaseCatchUp(campaignAs('ACTIVE', 'm2', 'PLAYER')); });
  await waitFor(() => expect(getMap).toHaveBeenLastCalledWith('c1', 'm2'));
  expect(latest!.currentMap?.id).toBe('m1');

  let releaseA: (() => void) | null = null;
  getMap.mockImplementation((_c: string, mapId: string) => new Promise((resolve) => {
    if (mapId === 'm1') {
      releaseA = () => resolve({ map: { id: mapId, tokens: [tokenAt('from-a', 1, 1)] }, spiritVisible: false });
    } else {
      resolve({ map: { id: mapId, tokens: [tokenAt('other', 0, 0)] }, spiritVisible: false });
    }
  }));
  act(() => { void latest!.refreshCurrentMap(); });

  await act(async () => { releaseB(); await catching; });
  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-b']);

  if (releaseA) {
    await act(async () => { releaseA!(); });
  }
  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-b']);
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('from-a');
});

const onRoleChangedHandler = () =>
  socketOn.mock.calls
    .filter(([event]) => event === 'campaign.role.changed')
    .pop()?.[1] as ((d: { campaignId: string; userId: string; role: string }) => void) | undefined;

const holdGetMap = () => {
  let releaseMap: (value?: { map: { id: string; tokens: Token[]; spiritLayerUrl?: string }; spiritVisible: boolean }) => void = () => {};
  let failMap: (err: unknown) => void = () => {};
  getMap.mockImplementationOnce((_c: string, mapId: string) => new Promise((resolve, reject) => {
    releaseMap = (value) => resolve(value ?? { map: { id: mapId, tokens: [tokenAt('t1', 1, 1)] }, spiritVisible: false });
    failMap = reject;
  }));
  return {
    release: () => releaseMap(),
    releaseWith: (value: { map: { id: string; tokens: Token[]; spiritLayerUrl?: string }; spiritVisible: boolean }) => releaseMap(value),
    fail: (err: unknown) => failMap(err),
  };
};

const mapUnavailable = () =>
  Object.assign(new Error('map down'), { response: { status: 500, data: { message: 'Map unavailable' } } });

// Pause and end bump the status/session clock; another member's role bumps
// the role/membership clock. They must not abort an in-flight map hydrate:
// the body is still filtered for this user's role. This user's own role
// change still rejects a DM body and surfaces Retry.

it('hydrates the first getMap after a pause while it was in flight', async () => {
  let releaseCampaign: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCampaign = resolve;
  }));
  const mapHold = holdGetMap();
  renderCampaign();
  await waitFor(() => expect(getCampaign).toHaveBeenCalled());
  await waitFor(() => expect(latest).not.toBeNull());

  await act(async () => { releaseCampaign(campaignAs('ACTIVE', 'm1', 'DM')); });
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));
  await waitFor(() => expect(getMap).toHaveBeenCalledWith('c1', 'm1'));
  expect(latest!.currentMap).toBeNull();
  expect(latest!.campaign?.currentMapId).toBe('m1');

  act(() => {
    latest!.updateCampaignStatus(CampaignStatus.PAUSED);
  });

  await act(async () => { mapHold.release(); });

  expect(latest!.currentMap?.id).toBe('m1');
  expect(latest!.campaign?.currentMapId).toBe('m1');
  expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED);
  expect(latest!.mapLoadError).toBeNull();
});

it('hydrates the first getMap after the session ends while it was in flight', async () => {
  let releaseCampaign: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCampaign = resolve;
  }));
  const mapHold = holdGetMap();
  renderCampaign();
  await waitFor(() => expect(getCampaign).toHaveBeenCalled());
  await waitFor(() => expect(latest).not.toBeNull());

  await act(async () => { releaseCampaign(campaignAs('ACTIVE', 'm1', 'DM')); });
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));
  await waitFor(() => expect(getMap).toHaveBeenCalledWith('c1', 'm1'));

  act(() => {
    latest!.updateCampaignStatus(CampaignStatus.INACTIVE);
    latest!.setActiveSession(null);
  });

  await act(async () => { mapHold.release(); });

  expect(latest!.currentMap?.id).toBe('m1');
  expect(latest!.campaign?.currentMapId).toBe('m1');
  expect(latest!.campaign?.status).toBe(CampaignStatus.INACTIVE);
  expect(latest!.activeSession).toBeNull();
  expect(latest!.mapLoadError).toBeNull();
});

it('sets mapLoadError when first getMap fails after a pause', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  const mapHold = holdGetMap();
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));
  await waitFor(() => expect(getMap).toHaveBeenCalledWith('c1', 'm1'));

  act(() => {
    latest!.updateCampaignStatus(CampaignStatus.PAUSED);
  });

  await act(async () => { mapHold.fail(mapUnavailable()); });

  expect(latest!.mapLoadError).toEqual({ mapId: 'm1', message: 'Map unavailable' });
  expect(latest!.currentMap).toBeNull();
  expect(latest!.campaign?.currentMapId).toBe('m1');
});

it('hydrates catch-up map B when paused during the claimed getMap', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm2', 'PLAYER'));
  const mapHold = holdGetMap();
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ ok: false, message: '' });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getMap).toHaveBeenLastCalledWith('c1', 'm2'));

  act(() => {
    latest!.updateCampaignStatus(CampaignStatus.PAUSED);
  });

  let catchUpResult: TableRetryOutcome | undefined;
  await act(async () => {
    mapHold.release();
    catchUpResult = await catching;
  });

  expect(catchUpResult).toEqual({ ok: true, message: 'Table synced' });
  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED);
  expect(latest!.syncError).toBeNull();
});

it('sets syncError when catch-up getMap of claimed B fails after a pause', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm2', 'PLAYER'));
  const mapHold = holdGetMap();
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getMap).toHaveBeenLastCalledWith('c1', 'm2'));

  act(() => {
    latest!.updateCampaignStatus(CampaignStatus.PAUSED);
  });

  let catchUpResult: TableRetryOutcome | undefined;
  await act(async () => {
    mapHold.fail(mapUnavailable());
    catchUpResult = await catching;
  });

  expect(catchUpResult).toEqual({ ok: false, message: 'Map unavailable' });
  expect(latest!.syncError).toBe('Map unavailable');
  expect(latest!.currentMap?.id).toBe('m1');
});

it('does not apply a DM first-load getMap after this user is demoted and offers Retry', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  const mapHold = holdGetMap();
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));
  await waitFor(() => expect(getMap).toHaveBeenCalledWith('c1', 'm1'));
  expect(latest!.userRole).toBe('DM');

  const onRoleChanged = onRoleChangedHandler();
  expect(onRoleChanged).toBeDefined();

  act(() => {
    onRoleChanged!({ campaignId: 'c1', userId: 'me', role: 'PLAYER' });
  });
  expect(latest!.userRole).toBe('PLAYER');

  await act(async () => {
    mapHold.releaseWith({
      map: {
        id: 'm1',
        tokens: [tokenAt('visible', 1, 1), { id: 'spirit-1', layer: TokenLayer.SPIRIT } as Token],
        spiritLayerUrl: 'https://example/spirit-dm.png',
      },
      spiritVisible: true,
    });
  });

  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.currentMap).toBeNull();
  expect(latest!.campaign?.currentMapId).toBe('m1');
  expect(latest!.mapLoadError).toEqual({ mapId: 'm1', message: 'Failed to load map' });
  expect(latest!.playerSpiritVisible).toBe(false);
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('spirit-1');
});

it('does not apply a DM catch-up getMap of claimed B after demotion and offers Retry', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({
      map: {
        id: mapId,
        tokens: [tokenAt('visible', 1, 1)],
        spiritLayerUrl: 'https://example/spirit-m1.png',
      },
      spiritVisible: false,
    }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.userRole).toBe('DM');

  const onRoleChanged = onRoleChangedHandler();
  expect(onRoleChanged).toBeDefined();

  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm2', 'DM'));
  const mapHold = holdGetMap();
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getMap).toHaveBeenLastCalledWith('c1', 'm2'));

  act(() => {
    onRoleChanged!({ campaignId: 'c1', userId: 'me', role: 'PLAYER' });
    latest!.setPlayerSpiritVisible(false);
    useGameStore.getState().setTokens([tokenAt('visible', 1, 1)]);
  });
  expect(latest!.userRole).toBe('PLAYER');

  let catchUpResult: TableRetryOutcome | undefined;
  await act(async () => {
    mapHold.releaseWith({
      map: {
        id: 'm2',
        tokens: [tokenAt('visible', 1, 1), { id: 'spirit-1', layer: TokenLayer.SPIRIT } as Token],
        spiritLayerUrl: 'https://example/spirit-dm.png',
      },
      spiritVisible: true,
    });
    catchUpResult = await catching;
  });

  expect(catchUpResult).toEqual({ ok: false, message: 'Failed to refresh the current map' });
  expect(latest!.syncError).toBe('Failed to refresh the current map');
  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.currentMap?.id).toBe('m1');
  expect(latest!.campaign?.currentMapId).toBe('m1');
  expect(latest!.playerSpiritVisible).toBe(false);
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('spirit-1');
  expect(latest!.currentMap?.spiritLayerUrl).not.toBe('https://example/spirit-dm.png');
});

it('hydrates the first getMap when another member\'s role changes while it is in flight', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    memberships: [{ userId: 'me', role: 'DM' }, { userId: 'other', role: 'PLAYER' }],
  });
  const mapHold = holdGetMap();
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.id).toBe('c1'));
  await waitFor(() => expect(getMap).toHaveBeenCalledWith('c1', 'm1'));

  const onRoleChanged = onRoleChangedHandler();
  expect(onRoleChanged).toBeDefined();

  act(() => {
    onRoleChanged!({ campaignId: 'c1', userId: 'other', role: 'SPECTATOR' });
  });
  expect(latest!.userRole).toBe('DM');

  await act(async () => { mapHold.release(); });

  expect(latest!.currentMap?.id).toBe('m1');
  expect(latest!.campaign?.currentMapId).toBe('m1');
  expect(latest!.mapLoadError).toBeNull();
  expect(latest!.userRole).toBe('DM');
});

it('hydrates retryMapLoad when paused while getMap is in flight', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockRejectedValueOnce(mapUnavailable());
  renderCampaign();
  await waitFor(() => expect(latest?.mapLoadError).toEqual({ mapId: 'm1', message: 'Map unavailable' }));

  const mapHold = holdGetMap();
  let retryResult: TableRetryOutcome | undefined;
  act(() => { void latest!.retryMapLoad().then((result) => { retryResult = result; }); });
  await waitFor(() => expect(getMap).toHaveBeenCalledTimes(2));

  act(() => {
    latest!.updateCampaignStatus(CampaignStatus.PAUSED);
  });

  await act(async () => { mapHold.release(); });
  await waitFor(() => expect(retryResult).toEqual({ ok: true, message: 'Map loaded' }));

  expect(latest!.currentMap?.id).toBe('m1');
  expect(latest!.mapLoadError).toBeNull();
});

it('sets mapLoadError when retryMapLoad fails after a pause', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockRejectedValueOnce(mapUnavailable());
  renderCampaign();
  await waitFor(() => expect(latest?.mapLoadError).toEqual({ mapId: 'm1', message: 'Map unavailable' }));

  const mapHold = holdGetMap();
  let retryResult: TableRetryOutcome | undefined;
  act(() => { void latest!.retryMapLoad().then((result) => { retryResult = result; }); });
  await waitFor(() => expect(getMap).toHaveBeenCalledTimes(2));

  act(() => {
    latest!.updateCampaignStatus(CampaignStatus.PAUSED);
  });

  await act(async () => { mapHold.fail(mapUnavailable()); });
  await waitFor(() => expect(retryResult).toEqual({ ok: false, message: 'Map unavailable' }));

  expect(latest!.mapLoadError).toEqual({ mapId: 'm1', message: 'Map unavailable' });
  expect(latest!.currentMap).toBeNull();
});

it('hydrates refreshCurrentMap when paused while getMap is in flight', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('old', 1, 1)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  const mapHold = holdGetMap();
  act(() => { void latest!.refreshCurrentMap(); });
  await waitFor(() => expect(getMap).toHaveBeenCalledTimes(2));

  act(() => {
    latest!.updateCampaignStatus(CampaignStatus.PAUSED);
  });

  await act(async () => {
    mapHold.releaseWith({
      map: { id: 'm1', tokens: [tokenAt('fresh', 8, 8)] },
      spiritVisible: false,
    });
  });

  expect(latest!.currentMap?.id).toBe('m1');
  expect(useGameStore.getState().tokens['fresh']?.position).toEqual({ x: 8, y: 8 });
  expect(latest!.syncError).toBeNull();
  expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED);
});

it('does not store a DM map list from a refresh GET after this user is demoted', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    maps: [{ id: 'keep-map', name: 'The Keep' }],
  });
  renderCampaign();
  await waitFor(() => expect(latest?.userRole).toBe('DM'));
  expect(latest!.campaign?.maps?.some((m) => m.spiritLayerUrl)).toBe(false);

  const onRoleChanged = onRoleChangedHandler();
  expect(onRoleChanged).toBeDefined();

  let releaseRefresh: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRefresh = resolve;
  }));
  let refreshing: Promise<boolean> = Promise.resolve(false);
  act(() => { refreshing = latest!.refreshCampaign(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    onRoleChanged!({ campaignId: 'c1', userId: 'me', role: 'PLAYER' });
  });
  expect(latest!.userRole).toBe('PLAYER');

  await act(async () => {
    releaseRefresh({
      ...campaignAs('ACTIVE', 'm1', 'DM'),
      memberships: [{ userId: 'me', role: 'DM' }, { userId: 'other', role: 'PLAYER' }],
      maps: [
        { id: 'keep-map', name: 'The Keep' },
        { id: 'other', spiritLayerUrl: 'https://example/spirit-other.png' },
      ],
    });
    await refreshing;
  });

  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.campaign?.maps?.some((m) => m.spiritLayerUrl === 'https://example/spirit-other.png')).toBe(false);
  expect(latest!.campaign?.maps?.some((m) => m.id === 'other')).toBe(false);
});

it('applies a missed pause from catch-up when another member\'s role changes during GET', async () => {
  const liveSession = { id: 'sess-live', sessionNumber: 2, startedAt: '2026-01-02T00:00:00.000Z' };
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    memberships: [{ userId: 'me', role: 'PLAYER' }, { userId: 'other', role: 'PLAYER' }],
    activeSession: liveSession,
  });
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.campaign?.status).toBe('ACTIVE');
  expect(latest!.activeSession).toEqual(liveSession);

  const onRoleChanged = onRoleChangedHandler();
  expect(onRoleChanged).toBeDefined();

  let releaseCampaign: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCampaign = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    onRoleChanged!({ campaignId: 'c1', userId: 'other', role: 'SPECTATOR' });
  });
  expect(latest!.campaign?.memberships?.find((m) => m.userId === 'other')?.role).toBe('SPECTATOR');

  await act(async () => {
    releaseCampaign({
      ...campaignAs('PAUSED', 'm1', 'PLAYER'),
      memberships: [{ userId: 'me', role: 'PLAYER' }, { userId: 'other', role: 'PLAYER' }],
      activeSession: null,
    });
    await catching;
  });

  expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED);
  expect(latest!.activeSession).toBeNull();
  expect(latest!.campaign?.memberships?.find((m) => m.userId === 'other')?.role).toBe('SPECTATOR');
  expect(latest!.userRole).toBe('PLAYER');
});

it('applies a missed pause from catch-up after this user is demoted during GET', async () => {
  const liveSession = { id: 'sess-live', sessionNumber: 2, startedAt: '2026-01-02T00:00:00.000Z' };
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    activeSession: liveSession,
  });
  renderCampaign();
  await waitFor(() => expect(latest?.userRole).toBe('DM'));
  expect(latest!.campaign?.status).toBe('ACTIVE');
  expect(latest!.activeSession).toEqual(liveSession);

  const onRoleChanged = onRoleChangedHandler();
  expect(onRoleChanged).toBeDefined();

  let releaseCampaign: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCampaign = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    onRoleChanged!({ campaignId: 'c1', userId: 'me', role: 'PLAYER' });
  });
  expect(latest!.userRole).toBe('PLAYER');

  await act(async () => {
    releaseCampaign({
      ...campaignAs('PAUSED', 'm1', 'DM'),
      activeSession: null,
    });
    await catching;
  });

  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED);
  expect(latest!.activeSession).toBeNull();
});

it('does not let a hung refresh GET restore name and chat after a settings PUT', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    name: 'Old Keep',
    description: 'Old blurb',
    chatCooldownEnabled: false,
    chatCooldownSeconds: 3,
  });
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.name).toBe('Old Keep'));

  let releaseRefresh: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRefresh = resolve;
  }));
  let refreshing: Promise<boolean> = Promise.resolve(false);
  act(() => { refreshing = latest!.refreshCampaign(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  await act(async () => {
    await latest!.refreshCampaign({
      ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
      name: 'New Keep',
      description: 'New blurb',
      chatCooldownEnabled: true,
      chatCooldownSeconds: 15,
    } as unknown as Campaign);
  });
  expect(latest!.campaign?.name).toBe('New Keep');
  expect(latest!.campaign?.chatCooldownSeconds).toBe(15);

  await act(async () => {
    releaseRefresh({
      ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
      name: 'Old Keep',
      description: 'Old blurb',
      chatCooldownEnabled: false,
      chatCooldownSeconds: 3,
    });
    await refreshing;
  });

  expect(latest!.campaign?.name).toBe('New Keep');
  expect(latest!.campaign?.description).toBe('New blurb');
  expect(latest!.campaign?.chatCooldownEnabled).toBe(true);
  expect(latest!.campaign?.chatCooldownSeconds).toBe(15);
});

it('does not let a hung refresh GET undo a local map create or delete', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    maps: [{ id: 'keep-map', name: 'The Keep' }],
  });
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.maps?.map((m) => m.id)).toEqual(['keep-map']));

  let releaseRefresh: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRefresh = resolve;
  }));
  let refreshing: Promise<boolean> = Promise.resolve(false);
  act(() => { refreshing = latest!.refreshCampaign(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    latest!.upsertCampaignMap({ id: 'new-map', name: 'Cellar' } as unknown as CampaignMap);
    latest!.removeCampaignMap('keep-map');
  });
  expect(latest!.campaign?.maps?.map((m) => m.id)).toEqual(['new-map']);

  await act(async () => {
    releaseRefresh({
      ...campaignAs('ACTIVE', 'm1', 'DM'),
      maps: [{ id: 'keep-map', name: 'The Keep' }],
    });
    await refreshing;
  });

  expect(latest!.campaign?.maps?.map((m) => m.id)).toEqual(['new-map']);
  expect(latest!.campaign?.maps?.some((m) => m.id === 'keep-map')).toBe(false);
});

it('does not apply a DM getMap after refreshCampaign GET learns PLAYER without a role event', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({
      map: {
        id: mapId,
        tokens: [tokenAt('visible', 1, 1), { id: 'spirit-1', layer: TokenLayer.SPIRIT } as Token],
        spiritLayerUrl: 'https://example/spirit-initial.png',
      },
      spiritVisible: true,
    }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.userRole).toBe('DM');

  const mapHold = holdGetMap();
  act(() => { void latest!.refreshCurrentMap(); });
  await waitFor(() => expect(getMap).toHaveBeenCalledTimes(2));

  let releaseRefresh: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRefresh = resolve;
  }));
  let refreshing: Promise<boolean> = Promise.resolve(false);
  act(() => { refreshing = latest!.refreshCampaign(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  await act(async () => {
    releaseRefresh(campaignAs('ACTIVE', 'm1', 'PLAYER'));
    await refreshing;
  });
  expect(latest!.userRole).toBe('PLAYER');

  act(() => {
    latest!.setPlayerSpiritVisible(false);
    useGameStore.getState().setTokens([tokenAt('visible', 1, 1)]);
  });

  await act(async () => {
    mapHold.releaseWith({
      map: {
        id: 'm1',
        tokens: [tokenAt('visible', 1, 1), { id: 'spirit-1', layer: TokenLayer.SPIRIT } as Token],
        spiritLayerUrl: 'https://example/spirit-dm.png',
      },
      spiritVisible: true,
    });
  });

  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.playerSpiritVisible).toBe(false);
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('spirit-1');
  expect(latest!.currentMap?.spiritLayerUrl).not.toBe('https://example/spirit-dm.png');
  expect(latest!.syncError).not.toBe('Failed to refresh the current map');
});

it('does not apply a DM getMap after roster GET learns PLAYER without a role event', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({
      map: {
        id: mapId,
        tokens: [tokenAt('visible', 1, 1), { id: 'spirit-1', layer: TokenLayer.SPIRIT } as Token],
        spiritLayerUrl: 'https://example/spirit-initial.png',
      },
      spiritVisible: true,
    }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.userRole).toBe('DM');

  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  expect(onRoster).toBeDefined();

  const mapHold = holdGetMap();
  act(() => { void latest!.refreshCurrentMap(); });
  await waitFor(() => expect(getMap).toHaveBeenCalledTimes(2));

  let releaseRoster: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRoster = resolve;
  }));
  await act(async () => { onRoster!({ action: 'member.joined', campaignId: 'c1', userId: 'newcomer' }); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  await act(async () => {
    releaseRoster(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  });
  expect(latest!.userRole).toBe('PLAYER');

  act(() => {
    latest!.setPlayerSpiritVisible(false);
    useGameStore.getState().setTokens([tokenAt('visible', 1, 1)]);
  });

  await act(async () => {
    mapHold.releaseWith({
      map: {
        id: 'm1',
        tokens: [tokenAt('visible', 1, 1), { id: 'spirit-1', layer: TokenLayer.SPIRIT } as Token],
        spiritLayerUrl: 'https://example/spirit-dm.png',
      },
      spiritVisible: true,
    });
  });

  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.playerSpiritVisible).toBe(false);
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('spirit-1');
  expect(latest!.currentMap?.spiritLayerUrl).not.toBe('https://example/spirit-dm.png');
  expect(latest!.syncError).not.toBe('Failed to refresh the current map');
});

it('does not store a DM map list from a refresh GET that itself returns PLAYER', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    maps: [{ id: 'keep-map', name: 'The Keep' }],
  });
  renderCampaign();
  await waitFor(() => expect(latest?.userRole).toBe('DM'));
  expect(latest!.campaign?.maps?.some((m) => m.spiritLayerUrl)).toBe(false);

  let releaseRefresh: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRefresh = resolve;
  }));
  let refreshing: Promise<boolean> = Promise.resolve(false);
  act(() => { refreshing = latest!.refreshCampaign(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  await act(async () => {
    releaseRefresh({
      ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
      maps: [{ id: 'm1', name: 'The Keep' }],
    });
    await refreshing;
  });

  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.campaign?.maps?.map((m) => m.id)).toEqual(['m1']);
  expect(latest!.campaign?.maps?.some((m) => m.spiritLayerUrl)).toBe(false);
  expect(latest!.campaign?.maps?.some((m) => m.id === 'other')).toBe(false);
});

it('applies a missed pause from a refresh GET when another member\'s role changes during GET', async () => {
  const liveSession = { id: 'sess-live', sessionNumber: 2, startedAt: '2026-01-02T00:00:00.000Z' };
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    memberships: [{ userId: 'me', role: 'PLAYER' }, { userId: 'other', role: 'PLAYER' }],
    activeSession: liveSession,
  });
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.campaign?.status).toBe('ACTIVE');
  expect(latest!.activeSession).toEqual(liveSession);

  const onRoleChanged = onRoleChangedHandler();
  expect(onRoleChanged).toBeDefined();

  let releaseRefresh: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRefresh = resolve;
  }));
  let refreshing: Promise<boolean> = Promise.resolve(false);
  act(() => { refreshing = latest!.refreshCampaign(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    onRoleChanged!({ campaignId: 'c1', userId: 'other', role: 'SPECTATOR' });
  });
  expect(latest!.campaign?.memberships?.find((m) => m.userId === 'other')?.role).toBe('SPECTATOR');

  await act(async () => {
    releaseRefresh({
      ...campaignAs('PAUSED', 'm1', 'PLAYER'),
      memberships: [{ userId: 'me', role: 'PLAYER' }, { userId: 'other', role: 'PLAYER' }],
      activeSession: null,
    });
    await refreshing;
  });

  expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED);
  expect(latest!.activeSession).toBeNull();
  expect(latest!.campaign?.memberships?.find((m) => m.userId === 'other')?.role).toBe('SPECTATOR');
  expect(latest!.userRole).toBe('PLAYER');
});

it('applies a missed pause from a roster GET when another member\'s role changes during GET', async () => {
  const liveSession = { id: 'sess-live', sessionNumber: 2, startedAt: '2026-01-02T00:00:00.000Z' };
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    memberships: [{ userId: 'me', role: 'PLAYER' }, { userId: 'other', role: 'PLAYER' }],
    activeSession: liveSession,
  });
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.campaign?.status).toBe('ACTIVE');
  expect(latest!.activeSession).toEqual(liveSession);

  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  const onRoleChanged = onRoleChangedHandler();
  expect(onRoster).toBeDefined();
  expect(onRoleChanged).toBeDefined();

  let releaseRoster: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRoster = resolve;
  }));
  await act(async () => { onRoster!({ action: 'member.joined', campaignId: 'c1', userId: 'newcomer' }); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    onRoleChanged!({ campaignId: 'c1', userId: 'other', role: 'SPECTATOR' });
  });
  expect(latest!.campaign?.memberships?.find((m) => m.userId === 'other')?.role).toBe('SPECTATOR');

  await act(async () => {
    releaseRoster({
      ...campaignAs('PAUSED', 'm1', 'PLAYER'),
      memberships: [{ userId: 'me', role: 'PLAYER' }, { userId: 'other', role: 'PLAYER' }],
      activeSession: null,
    });
  });

  expect(latest!.campaign?.status).toBe(CampaignStatus.PAUSED);
  expect(latest!.activeSession).toBeNull();
  expect(latest!.campaign?.memberships?.find((m) => m.userId === 'other')?.role).toBe('SPECTATOR');
  expect(latest!.userRole).toBe('PLAYER');
});

it('strips DM spirit state and extra maps when this user is demoted to PLAYER', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    maps: [
      { id: 'm1', name: 'Table' },
      { id: 'other', spiritLayerUrl: 'https://example/spirit-other.png' },
    ],
  });
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({
      map: {
        id: mapId,
        tokens: [tokenAt('visible', 1, 1), { id: 'spirit-1', layer: TokenLayer.SPIRIT } as Token],
        spiritLayerUrl: 'https://example/spirit-dm.png',
      },
      spiritVisible: true,
    }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.userRole).toBe('DM');
  expect(latest!.playerSpiritVisible).toBe(true);
  expect(Object.keys(useGameStore.getState().tokens)).toContain('spirit-1');

  const onRoleChanged = onRoleChangedHandler();
  expect(onRoleChanged).toBeDefined();
  const mapHold = holdGetMap();

  act(() => {
    onRoleChanged!({ campaignId: 'c1', userId: 'me', role: 'PLAYER' });
  });

  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.playerSpiritVisible).toBe(false);
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('spirit-1');
  expect(Object.keys(useGameStore.getState().tokens)).toContain('visible');
  expect(latest!.currentMap?.spiritLayerUrl).not.toBe('https://example/spirit-dm.png');
  expect(latest!.campaign?.maps?.some((m) => m.spiritLayerUrl === 'https://example/spirit-other.png')).toBe(false);
  expect(latest!.campaign?.maps?.some((m) => m.id === 'other')).toBe(false);
  expect(latest!.syncError).toBeNull();

  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    maps: [{ id: 'm1', name: 'Player Keep' }],
  });
  await act(async () => { await latest!.refreshCampaign(); });
  expect(latest!.campaign?.maps?.map((m) => m.id)).toEqual(['m1']);
  expect(latest!.campaign?.maps?.[0]?.name).toBe('Player Keep');
  expect(latest!.campaign?.maps?.some((m) => m.spiritLayerUrl)).toBe(false);

  await act(async () => {
    mapHold.releaseWith({
      map: {
        id: 'm1',
        tokens: [tokenAt('visible', 1, 1)],
        spiritLayerUrl: undefined,
      },
      spiritVisible: false,
    });
  });
});

it('strips DM spirit state when refreshCampaign GET adopts PLAYER without a role event', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    maps: [
      { id: 'm1', name: 'Table' },
      { id: 'other', spiritLayerUrl: 'https://example/spirit-other.png' },
    ],
  });
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({
      map: {
        id: mapId,
        tokens: [tokenAt('visible', 1, 1), { id: 'spirit-1', layer: TokenLayer.SPIRIT } as Token],
        spiritLayerUrl: 'https://example/spirit-dm.png',
      },
      spiritVisible: true,
    }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.userRole).toBe('DM');
  expect(latest!.playerSpiritVisible).toBe(true);
  expect(Object.keys(useGameStore.getState().tokens)).toContain('spirit-1');

  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    maps: [{ id: 'm1', name: 'Player Keep' }],
  });
  getMap.mockResolvedValueOnce({
    map: {
      id: 'm1',
      tokens: [tokenAt('visible', 1, 1)],
      spiritLayerUrl: undefined,
    },
    spiritVisible: false,
  });
  await act(async () => { await latest!.refreshCampaign(); });

  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.playerSpiritVisible).toBe(false);
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('spirit-1');
  expect(Object.keys(useGameStore.getState().tokens)).toContain('visible');
  expect(latest!.currentMap?.spiritLayerUrl).not.toBe('https://example/spirit-dm.png');
  expect(latest!.campaign?.maps?.map((m) => m.id)).toEqual(['m1']);
  expect(latest!.campaign?.maps?.[0]?.name).toBe('Player Keep');
  expect(latest!.campaign?.maps?.some((m) => m.spiritLayerUrl)).toBe(false);
  expect(latest!.campaign?.maps?.some((m) => m.id === 'other')).toBe(false);
});

it('keeps name and chat cooldown from the later of two overlapping refreshCampaign GETs', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    name: 'Original Keep',
    chatCooldownEnabled: false,
    chatCooldownSeconds: 3,
  });
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.name).toBe('Original Keep'));

  let releaseEarlier: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseEarlier = resolve;
  }));
  let earlier: Promise<boolean> = Promise.resolve(false);
  act(() => { earlier = latest!.refreshCampaign(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  let releaseLater: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseLater = resolve;
  }));
  let later: Promise<boolean> = Promise.resolve(false);
  act(() => { later = latest!.refreshCampaign(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(3));

  await act(async () => {
    releaseLater({
      ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
      name: 'Later Keep',
      chatCooldownEnabled: true,
      chatCooldownSeconds: 20,
    });
    await later;
  });
  expect(latest!.campaign?.name).toBe('Later Keep');
  expect(latest!.campaign?.chatCooldownSeconds).toBe(20);

  await act(async () => {
    releaseEarlier({
      ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
      name: 'Earlier Keep',
      chatCooldownEnabled: false,
      chatCooldownSeconds: 5,
    });
    await earlier;
  });

  expect(latest!.campaign?.name).toBe('Later Keep');
  expect(latest!.campaign?.chatCooldownEnabled).toBe(true);
  expect(latest!.campaign?.chatCooldownSeconds).toBe(20);
});

it('copies characters from catch-up when the role clock is unchanged', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    characters: [{ id: 'char-old', userId: 'me', name: 'Harvey' }],
  });
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.characters?.map((c) => c.id)).toEqual(['char-old']));

  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    characters: [{ id: 'char-new', userId: 'newcomer', name: 'Aldra' }],
  });
  await act(async () => { await latest!.catchUpAfterReconnect(); });

  expect(latest!.campaign?.characters?.map((c) => c.id)).toEqual(['char-new']);
});

it('does not restore characters from an older catch-up after a newer roster GET', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    characters: [{ id: 'char-old', userId: 'me', name: 'Harvey' }],
  });
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.characters?.map((c) => c.id)).toEqual(['char-old']));

  let releaseCatchUp: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCatchUp = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  expect(onRoster).toBeDefined();
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'DM'),
    characters: [{ id: 'char-roster', userId: 'newcomer', name: 'Aldra' }],
  });
  await act(async () => { onRoster!({ action: 'character.assigned', campaignId: 'c1', characterId: 'char-roster', userId: 'newcomer' }); });
  await waitFor(() => expect(latest!.campaign?.characters?.map((c) => c.id)).toEqual(['char-roster']));

  await act(async () => {
    releaseCatchUp({
      ...campaignAs('ACTIVE', 'm1', 'DM'),
      characters: [{ id: 'char-old', userId: 'me', name: 'Harvey' }],
    });
    await catching;
  });

  expect(latest!.campaign?.characters?.map((c) => c.id)).toEqual(['char-roster']);
});

const lockedDoor = { id: 'door-1', x1: 0, y1: 0, x2: 40, y2: 0, type: 'door-locked' as const };
const closedDoor = { id: 'door-1', x1: 0, y1: 0, x2: 40, y2: 0, type: 'door-closed' as const };
const dmLight = { id: 'light-1', x: 10, y: 10, brightRadius: 2, dimRadius: 4, color: '#ffcc66', enabled: true };
const hiddenCreature = { ...tokenAt('hidden', 8, 8), visible: false, notes: 'Keeper notes' } as Token;
const notedVisible = { ...tokenAt('visible', 1, 1), notes: 'Keeper notes', statBlock: { ac: 15 } } as unknown as Token;

it('hydrates a player-filtered map when refreshCampaign GET adopts PLAYER without a role event', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({
      map: {
        id: mapId,
        tokens: [tokenAt('visible', 1, 1), hiddenCreature, { id: 'spirit-1', layer: TokenLayer.SPIRIT } as Token],
        wallSegments: [lockedDoor],
        lights: [dmLight],
        spiritLayerUrl: 'https://example/spirit-dm.png',
      },
      spiritVisible: true,
    }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.userRole).toBe('DM');
  expect(latest!.playerSpiritVisible).toBe(true);
  expect(Object.keys(useGameStore.getState().tokens)).toContain('hidden');
  expect(latest!.currentMap?.wallSegments?.some((w) => w.type === 'door-locked')).toBe(true);

  const getMapCallsAfterLoad = getMap.mock.calls.length;
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    maps: [{ id: 'm1', name: 'Player Keep' }],
  });
  getMap.mockResolvedValueOnce({
    map: {
      id: 'm1',
      tokens: [tokenAt('visible', 1, 1)],
      wallSegments: [closedDoor],
      lights: [],
      spiritLayerUrl: undefined,
    },
    spiritVisible: false,
  });
  await act(async () => { await latest!.refreshCampaign(); });

  expect(latest!.userRole).toBe('PLAYER');
  expect(getMap.mock.calls.length).toBeGreaterThan(getMapCallsAfterLoad);
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['visible']);
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('hidden');
  expect(latest!.currentMap?.wallSegments).toEqual([closedDoor]);
  expect(latest!.currentMap?.wallSegments?.some((w) => w.type === 'door-locked')).toBe(false);
  expect(latest!.currentMap?.lights).toEqual([]);
  expect(latest!.playerSpiritVisible).toBe(false);

  const getMapCallsAfterPlayerHydrate = getMap.mock.calls.length;
  const onAuthenticated = socketOn.mock.calls
    .filter(([event]) => event === 'authenticated')
    .pop()?.[1] as ((d: { campaignId: string; userId: string; role: string }) => void) | undefined;
  expect(onAuthenticated).toBeDefined();
  act(() => {
    onAuthenticated!({ campaignId: 'c1', userId: 'me', role: 'PLAYER' });
  });
  expect(getMap.mock.calls.length).toBe(getMapCallsAfterPlayerHydrate);
  expect(latest!.userRole).toBe('PLAYER');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['visible']);
});

it('strips hidden tokens, notes, and locked doors when GET adopts PLAYER before player getMap returns', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({
      map: {
        id: mapId,
        tokens: [notedVisible, hiddenCreature, { id: 'spirit-1', layer: TokenLayer.SPIRIT } as Token],
        wallSegments: [lockedDoor],
        lights: [dmLight],
        spiritLayerUrl: 'https://example/spirit-dm.png',
      },
      spiritVisible: true,
    }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.userRole).toBe('DM');
  expect(Object.keys(useGameStore.getState().tokens)).toContain('hidden');
  expect(useGameStore.getState().tokens['visible']?.notes).toBe('Keeper notes');
  expect(latest!.currentMap?.wallSegments?.some((w) => w.type === 'door-locked')).toBe(true);

  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  const mapHold = holdGetMap();
  let refreshing: Promise<boolean> = Promise.resolve(false);
  act(() => { refreshing = latest!.refreshCampaign(); });
  await waitFor(() => expect(getMap).toHaveBeenCalledTimes(2));

  expect(latest!.userRole).toBe('PLAYER');
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('hidden');
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('spirit-1');
  expect(Object.keys(useGameStore.getState().tokens)).toContain('visible');
  expect(useGameStore.getState().tokens['visible']?.notes).toBe('');
  expect(useGameStore.getState().tokens['visible']?.statBlock).toBeNull();
  expect(latest!.currentMap?.wallSegments?.some((w) => w.type === 'door-locked')).toBe(false);
  expect(latest!.currentMap?.wallSegments?.some((w) => w.id === 'door-1' && w.type === 'door-closed')).toBe(true);
  expect(latest!.playerSpiritVisible).toBe(false);

  await act(async () => {
    mapHold.fail(mapUnavailable());
    await refreshing;
  });
});

it('refetches the on-screen map as PLAYER when a demotion GET of B is discarded after a live switch', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({
      map: { id: mapId, tokens: [tokenAt('from-a', 1, 1), hiddenCreature], wallSegments: [lockedDoor] },
      spiritVisible: true,
    }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.userRole).toBe('DM');

  let releaseRefresh: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRefresh = resolve;
  }));
  let refreshing: Promise<boolean> = Promise.resolve(false);
  act(() => { refreshing = latest!.refreshCampaign(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  act(() => {
    latest!.setCurrentMap({ id: 'm2', tokens: [tokenAt('live', 9, 9)] } as unknown as CampaignMap);
    useGameStore.getState().setTokens([tokenAt('live', 9, 9)]);
  });

  getMap.mockResolvedValueOnce({
    map: { id: 'm2', tokens: [tokenAt('from-live', 3, 3)] },
    spiritVisible: false,
  });
  await act(async () => {
    releaseRefresh(campaignAs('ACTIVE', 'm3', 'PLAYER'));
    await refreshing;
  });

  expect(latest!.userRole).toBe('PLAYER');
  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(getMap.mock.calls.some(([, mapId]) => mapId === 'm3')).toBe(false);
  expect(getMap).toHaveBeenLastCalledWith('c1', 'm2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-live']);
});

it('hydrates a player-filtered map when catch-up GET adopts PLAYER without a role event', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'DM'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({
      map: {
        id: mapId,
        tokens: [tokenAt('visible', 1, 1), hiddenCreature],
        wallSegments: [lockedDoor],
        spiritLayerUrl: 'https://example/spirit-dm.png',
      },
      spiritVisible: true,
    }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(latest!.userRole).toBe('DM');

  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockResolvedValueOnce({
    map: {
      id: 'm1',
      tokens: [tokenAt('visible', 1, 1)],
      wallSegments: [closedDoor],
      spiritLayerUrl: undefined,
    },
    spiritVisible: false,
  });
  await act(async () => { await latest!.catchUpAfterReconnect(); });

  expect(latest!.userRole).toBe('PLAYER');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['visible']);
  expect(latest!.currentMap?.wallSegments).toEqual([closedDoor]);
  expect(latest!.playerSpiritVisible).toBe(false);
});

it('hydrates tokens from a winning roster GET that keeps the map already on screen', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('from-a', 1, 1)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-a']);

  let releaseCatchUp: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCatchUp = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  expect(onRoster).toBeDefined();
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockResolvedValueOnce({
    map: { id: 'm1', tokens: [tokenAt('from-caught-up', 2, 2)] },
    spiritVisible: false,
  });
  await act(async () => { onRoster!({ action: 'member.joined', campaignId: 'c1', userId: 'newcomer' }); });
  await waitFor(() => expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-caught-up']));
  expect(latest!.currentMap?.id).toBe('m1');
  expect(latest!.syncError).toBeNull();

  await act(async () => {
    releaseCatchUp(campaignAs('ACTIVE', 'm1', 'PLAYER'));
    await catching;
  });

  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-caught-up']);
  expect(latest!.currentMap?.id).toBe('m1');
  expect(latest!.syncError).toBeNull();
});

it('sets syncError when a winning same-id roster getMap fails and keeps last tokens', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('from-a', 1, 1)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-a']);

  let releaseCatchUp: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCatchUp = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  expect(onRoster).toBeDefined();
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockRejectedValueOnce(mapUnavailable());
  await act(async () => { onRoster!({ action: 'member.joined', campaignId: 'c1', userId: 'newcomer' }); });
  await waitFor(() => expect(latest!.syncError).toBe('Map unavailable'));

  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-a']);
  expect(useGameStore.getState().tokens['from-a']?.position).toEqual({ x: 1, y: 1 });
  expect(latest!.currentMap?.id).toBe('m1');

  await act(async () => {
    releaseCatchUp(campaignAs('ACTIVE', 'm1', 'PLAYER'));
    await catching;
  });

  expect(latest!.syncError).toBe('Map unavailable');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-a']);
});

it('hydrates map B from a winning roster GET while hung catch-up is discarded', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('from-a', 1, 1)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  let releaseCatchUp: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCatchUp = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  expect(onRoster).toBeDefined();
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm2', 'PLAYER'));
  getMap.mockResolvedValueOnce({
    map: { id: 'm2', tokens: [tokenAt('from-b', 2, 2)] },
    spiritVisible: false,
  });
  await act(async () => { onRoster!({ action: 'member.joined', campaignId: 'c1', userId: 'newcomer' }); });
  await waitFor(() => expect(latest!.currentMap?.id).toBe('m2'));
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-b']);

  await act(async () => {
    releaseCatchUp(campaignAs('ACTIVE', 'm1', 'PLAYER'));
    await catching;
  });

  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-b']);
  expect(latest!.syncError).toBeNull();
});

it('clears the table when a winning roster GET has no current map while hung catch-up is discarded', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('from-a', 1, 1)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  let releaseCatchUp: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCatchUp = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  const onRoster = socketOn.mock.calls.filter(([event]) => event === 'roster.updated').pop()?.[1] as ((d: unknown) => void) | undefined;
  expect(onRoster).toBeDefined();
  getCampaign.mockResolvedValueOnce({ ...campaignAs('ACTIVE', 'm1', 'PLAYER'), currentMapId: null });
  await act(async () => { onRoster!({ action: 'member.joined', campaignId: 'c1', userId: 'newcomer' }); });
  await waitFor(() => expect(latest!.currentMap).toBeNull());
  expect(latest!.campaign?.currentMapId).toBeNull();

  await act(async () => {
    releaseCatchUp(campaignAs('ACTIVE', 'm2', 'PLAYER'));
    await catching;
  });

  expect(latest!.currentMap).toBeNull();
  expect(latest!.campaign?.currentMapId).toBeNull();
  expect(Object.keys(useGameStore.getState().tokens)).not.toContain('from-a');
  expect(latest!.syncError).toBeNull();
});

it('hydrates map B from a winning refreshCampaign GET while hung catch-up is discarded', async () => {
  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm1', 'PLAYER'));
  getMap.mockImplementationOnce((_c: string, mapId: string) =>
    Promise.resolve({ map: { id: mapId, tokens: [tokenAt('from-a', 1, 1)] }, spiritVisible: false }),
  );
  renderCampaign();
  await waitFor(() => expect(latest?.currentMap?.id).toBe('m1'));

  let releaseCatchUp: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCatchUp = resolve;
  }));
  let catching: Promise<TableRetryOutcome> = Promise.resolve({ discarded: true });
  act(() => { catching = latest!.catchUpAfterReconnect(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  getCampaign.mockResolvedValueOnce(campaignAs('ACTIVE', 'm2', 'PLAYER'));
  getMap.mockResolvedValueOnce({
    map: { id: 'm2', tokens: [tokenAt('from-b', 2, 2)] },
    spiritVisible: false,
  });
  await act(async () => { await latest!.refreshCampaign(); });
  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');

  await act(async () => {
    releaseCatchUp(campaignAs('ACTIVE', 'm1', 'PLAYER'));
    await catching;
  });

  expect(latest!.currentMap?.id).toBe('m2');
  expect(latest!.campaign?.currentMapId).toBe('m2');
  expect(Object.keys(useGameStore.getState().tokens)).toEqual(['from-b']);
});

it('keeps name and chat cooldown from the later of two overlapping settings PUT documents', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    name: 'Original Keep',
    chatCooldownEnabled: false,
    chatCooldownSeconds: 3,
  });
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.name).toBe('Original Keep'));

  // HTTP out of order: rename starts first, chat starts second, chat
  // returns first, rename returns last. Seq is taken when each write starts.
  let seqE = 0;
  let seqL = 0;
  act(() => { seqE = latest!.beginSettingsWrite(); });
  act(() => { seqL = latest!.beginSettingsWrite(); });
  expect(seqL).toBeGreaterThan(seqE);

  let laterApplied = false;
  await act(async () => {
    laterApplied = await latest!.refreshCampaign({
      ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
      name: 'Later Keep',
      description: 'Later blurb',
      chatCooldownEnabled: true,
      chatCooldownSeconds: 20,
      memberships: [{ userId: 'me', role: 'PLAYER' }, { userId: 'newcomer', role: 'PLAYER' }],
      maps: [{ id: 'later-map', name: 'Later Map' }],
      characters: [{ id: 'char-later', userId: 'newcomer', name: 'Aldra' }],
    } as unknown as Campaign, seqL);
  });
  expect(laterApplied).toBe(true);
  expect(latest!.campaign?.name).toBe('Later Keep');
  expect(latest!.campaign?.chatCooldownSeconds).toBe(20);

  let earlierApplied = true;
  await act(async () => {
    earlierApplied = await latest!.refreshCampaign({
      ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
      name: 'Earlier Keep',
      description: 'Earlier blurb',
      chatCooldownEnabled: false,
      chatCooldownSeconds: 5,
      memberships: [{ userId: 'me', role: 'PLAYER' }, { userId: 'stale', role: 'PLAYER' }],
      maps: [{ id: 'earlier-map', name: 'Earlier Map' }],
      characters: [{ id: 'char-stale', userId: 'stale', name: 'Harvey' }],
    } as unknown as Campaign, seqE);
  });

  expect(earlierApplied).toBe(false);
  expect(latest!.campaign?.name).toBe('Later Keep');
  expect(latest!.campaign?.description).toBe('Later blurb');
  expect(latest!.campaign?.chatCooldownEnabled).toBe(true);
  expect(latest!.campaign?.chatCooldownSeconds).toBe(20);
  expect(latest!.campaign?.memberships?.map((m) => m.userId)).toEqual(['me', 'newcomer']);
  expect(latest!.campaign?.maps?.map((m) => m.id)).toEqual(['later-map']);
  expect(latest!.campaign?.characters?.map((c) => c.id)).toEqual(['char-later']);
});

it('applies an earlier settings PUT when a later write never returns', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    name: 'Original Keep',
    chatCooldownEnabled: false,
    chatCooldownSeconds: 3,
  });
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.name).toBe('Original Keep'));

  // General save starts first, chat save starts second and fails before
  // refreshCampaign. The successful general document must still land.
  let seqE = 0;
  let seqL = 0;
  act(() => { seqE = latest!.beginSettingsWrite(); });
  act(() => { seqL = latest!.beginSettingsWrite(); });
  expect(seqL).toBeGreaterThan(seqE);

  let earlierApplied = false;
  await act(async () => {
    earlierApplied = await latest!.refreshCampaign({
      ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
      name: 'Earlier Keep',
      description: 'Earlier blurb',
      chatCooldownEnabled: false,
      chatCooldownSeconds: 5,
    } as unknown as Campaign, seqE);
  });

  expect(earlierApplied).toBe(true);
  expect(latest!.campaign?.name).toBe('Earlier Keep');
  expect(latest!.campaign?.description).toBe('Earlier blurb');
  expect(latest!.campaign?.chatCooldownEnabled).toBe(false);
  expect(latest!.campaign?.chatCooldownSeconds).toBe(5);
});

it('does not let a GET that started after beginSettingsWrite restore the pre-PUT name', async () => {
  getCampaign.mockResolvedValueOnce({
    ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
    name: 'Old Keep',
    description: 'Old blurb',
    chatCooldownEnabled: false,
    chatCooldownSeconds: 3,
  });
  renderCampaign();
  await waitFor(() => expect(latest?.campaign?.name).toBe('Old Keep'));

  let seq = 0;
  act(() => { seq = latest!.beginSettingsWrite(); });

  let releaseRefresh: (value: unknown) => void = () => {};
  getCampaign.mockImplementationOnce(() => new Promise((resolve) => {
    releaseRefresh = resolve;
  }));
  let refreshing: Promise<boolean> = Promise.resolve(false);
  act(() => { refreshing = latest!.refreshCampaign(); });
  await waitFor(() => expect(getCampaign).toHaveBeenCalledTimes(2));

  await act(async () => {
    await latest!.refreshCampaign({
      ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
      name: 'New Keep',
      description: 'New blurb',
      chatCooldownEnabled: true,
      chatCooldownSeconds: 15,
    } as unknown as Campaign, seq);
  });
  expect(latest!.campaign?.name).toBe('New Keep');
  expect(latest!.campaign?.chatCooldownSeconds).toBe(15);

  await act(async () => {
    releaseRefresh({
      ...campaignAs('ACTIVE', 'm1', 'PLAYER'),
      name: 'Old Keep',
      description: 'Old blurb',
      chatCooldownEnabled: false,
      chatCooldownSeconds: 3,
    });
    await refreshing;
  });

  expect(latest!.campaign?.name).toBe('New Keep');
  expect(latest!.campaign?.description).toBe('New blurb');
  expect(latest!.campaign?.chatCooldownEnabled).toBe(true);
  expect(latest!.campaign?.chatCooldownSeconds).toBe(15);
});

