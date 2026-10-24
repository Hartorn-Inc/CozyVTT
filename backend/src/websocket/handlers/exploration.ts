// ============================================
// Explored memory handlers: exploration:reveal / exploration:request /
// exploration:reset
//
// What each player has seen of a map, kept per user so the client can grey
// it in when it is out of sight. Stored in the FogState shape, so the fog
// helpers apply unchanged and a grid resize forgets it exactly as it forgets
// fog.
//
// The server NEVER reads MapExploration when deciding which tokens to send:
// exploration only greys in map artwork every client already holds. A forged
// reveal can therefore show a player nothing they were not already given.
// See filterTokensByLighting.
// ============================================

import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../auth';
import { prisma } from '../../config/database';
import { ExplorationRevealSchema } from '../../validators/walls';
import type { FogState } from '../../types/walls';
import logger from '../../utils/logger';
import { emitToMapReaders, onLiveCampaignDrop } from '../utils';
import { explorationRevealLimiter, limiterKey, stateRequestAllowed, withinCeiling, loadFogState, applyWsFogOperation, revealedCellIndices, broadcastExplorationState, fogFits, FogTooLargeError } from '../shared';
import { toJson } from '../../utils/prisma-json';
import { canReadMap } from '../../services/permissions';
import { confirmWriteAuthorization } from '../writeAuthz';

const MAP_SELECT = {
  campaignId: true, explorationEnabled: true, width: true, height: true, gridSize: true,
  campaign: { select: { currentMapId: true } },
} as const;

/**
 * Reports a second, per user. The page reports at most every 300 ms per tab,
 * so two tabs of one player send under seven; a dropped report's cells are
 * never remembered, since the page does not send them again.
 */
export const REVEALS_PER_SECOND = 40;

/** At most one write of a player's memory of a map in this long. */
const REVEAL_WRITE_MS = 1000;

/**
 * Cells reported and not yet written, per map and user. Each report used to
 * read and rewrite the whole memory, a boolean per grid cell; now the cells
 * of the reports that arrive within a second are written together. One write
 * queue per (map, user) shares the advisory lock; cells are kept per actor
 * so a DM preview and the player's own report in the same window cannot
 * overwrite each other's actor, and kicking one does not drop the other's
 * pending cells.
 */
interface QueuedReveal {
  campaignId: string;
  mapId: string;
  userId: string;
  /** Cells still waiting, keyed by socket.userId who reported them (the DM, when previewing another member). */
  cellsByActor: Map<string, Set<number>>;
  lastWrite: number;
  timer: ReturnType<typeof setTimeout> | null;
  writing: boolean;
}
const queuedReveals = new Map<string, QueuedReveal>();

function queuedCellCount(queued: QueuedReveal): number {
  let n = 0;
  for (const cells of queued.cellsByActor.values()) n += cells.size;
  return n;
}

function queueReveal(io: Server, campaignId: string, mapId: string, userId: string, cells: number[], actorId: string): void {
  const key = `${mapId}:${userId}`;
  let queued = queuedReveals.get(key);
  if (!queued) {
    queued = { campaignId, mapId, userId, cellsByActor: new Map(), lastWrite: 0, timer: null, writing: false };
    queuedReveals.set(key, queued);
  }
  let actorCells = queued.cellsByActor.get(actorId);
  if (!actorCells) {
    actorCells = new Set();
    queued.cellsByActor.set(actorId, actorCells);
  }
  for (const cell of cells) actorCells.add(cell);
  scheduleRevealWrite(io, key, queued);
}

function scheduleRevealWrite(io: Server, key: string, queued: QueuedReveal): void {
  if (queued.timer || queued.writing || queuedCellCount(queued) === 0) return;
  const wait = Math.max(0, queued.lastWrite + REVEAL_WRITE_MS - Date.now());
  queued.timer = setTimeout(() => void writeQueuedReveal(io, key, queued), wait);
  queued.timer.unref?.();
}

/**
 * Per-map explored-memory clock, independent of `joinedEpoch` and of
 * `campaign.currentMapId`. Starts at a process-lifetime base so a restart
 * never advertises an epoch older than a mounted client's last applied
 * value. Incremented only on `exploration:reset`. In memory; not a Prisma
 * field. Token, fog and ping handlers must not read this.
 */
const PROCESS_EXPLORATION_EPOCH_BASE = Date.now();
const explorationEpochs = new Map<string, number>();

function explorationEpochFor(mapId: string): number {
  return explorationEpochs.get(mapId) ?? PROCESS_EXPLORATION_EPOCH_BASE;
}

function bumpExplorationEpoch(mapId: string): number {
  const next = explorationEpochFor(mapId) + 1;
  explorationEpochs.set(mapId, next);
  return next;
}

/**
 * Reset won the map's explored-memory clock while this write still held a
 * row (or thought it did). Throwing rolls the upsert back so forgotten
 * cells are not committed at the new epoch.
 */
class ExplorationEpochConflict extends Error {
  override name = 'ExplorationEpochConflict';
  constructor() {
    super('exploration epoch changed during write');
  }
}

function isExplorationEpochConflict(error: unknown): boolean {
  return error instanceof ExplorationEpochConflict
    || (error instanceof Error && error.name === 'ExplorationEpochConflict');
}

async function writeQueuedReveal(io: Server, key: string, queued: QueuedReveal): Promise<void> {
  queued.timer = null;
  queued.writing = true;
  queued.lastWrite = Date.now();
  const pendingByActor = queued.cellsByActor;
  queued.cellsByActor = new Map();
  const { campaignId, mapId, userId } = queued;
  const cells = [...pendingByActor.values()].flatMap((set) => [...set]);
  const epochAtStart = explorationEpochFor(mapId);
  try {
    // Read again: memory can be turned off, or the map moved or resized past
    // what memory can hold, within the second. A reset that lands while this
    // write is in flight bumps the map's epoch under the explored-memory
    // lock; we then abort so forgotten cells are not stored or broadcast as
    // a post-reset replace.
    const map = await prisma.map.findUnique({ where: { id: mapId }, select: MAP_SELECT });
    if (!map || map.campaignId !== campaignId || !map.explorationEnabled || !fogFits(map)) return;
    if (explorationEpochFor(mapId) !== epochAtStart) return;
    // Cells already remembered, which is what the page reports most of the
    // time it moves about known ground, are not worth a lock or a write.
    const held = await prisma.mapExploration.findUnique({ where: { mapId_userId: { mapId, userId } }, select: { explored: true } });
    const known = loadFogState(map, (held?.explored as FogState | null) ?? null);
    if (cells.length === 0 || cells.every((cell) => cell >= known.revealed.length || known.revealed[cell])) return;
    // Exclusive explored-memory lock first, same two-argument key as reset
    // (not the single-key map JSON lock), so deleteMany and this upsert
    // cannot interleave. Then one writer per (map, user): two tabs, or two
    // reports in flight, would each read the row and write back only their
    // own cells; both locks are released when the transaction ends.
    const cellsNow = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${mapId}), hashtext('explored-memory'))`;
      if (explorationEpochFor(mapId) !== epochAtStart) throw new ExplorationEpochConflict();
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${mapId}), hashtext(${userId}))`;
      const owner = await tx.campaignMembership.findUnique({
        where: { userId_campaignId: { userId, campaignId } },
        select: { userId: true },
      });
      if (!owner) return null;
      const authorized = new Set<number>();
      for (const [actorId, actorCells] of pendingByActor) {
        if (actorId === userId) {
          for (const cell of actorCells) authorized.add(cell);
          continue;
        }
        // A DM preview writes another member's memory: that actor must still
        // be the DM. The memory owner's own reveal was enough above.
        const actor = await tx.campaignMembership.findUnique({
          where: { userId_campaignId: { userId: actorId, campaignId } },
          select: { role: true },
        });
        if (!actor || actor.role !== 'DM') continue;
        for (const cell of actorCells) authorized.add(cell);
      }
      if (authorized.size === 0) return null;
      const row = await tx.mapExploration.findUnique({
        where: { mapId_userId: { mapId, userId } },
        select: { explored: true },
      });
      const explored: FogState = loadFogState(map, (row?.explored as FogState | null) ?? null);
      const before = revealedCellIndices(explored).length;
      applyWsFogOperation(explored, { op: 'reveal', cells: [...authorized] });
      const after = revealedCellIndices(explored);
      // Nothing new: nothing to write, and nobody's memory to resend.
      if (after.length === before) return null;
      await tx.mapExploration.upsert({
        where: { mapId_userId: { mapId, userId } },
        create: { mapId, userId, explored: toJson(explored) },
        update: { explored: toJson(explored) },
      });
      if (explorationEpochFor(mapId) !== epochAtStart) throw new ExplorationEpochConflict();
      return after;
    });
    if (explorationEpochFor(mapId) !== epochAtStart) {
      // Reset took the explored-memory lock after this commit, deleted the
      // row, and already broadcast empty at the new epoch. Do not delete
      // or broadcast here: a later reveal at that epoch may already hold
      // the row, and an unlocked delete would wipe it.
      return;
    }
    if (cellsNow) await broadcastExplorationState(io, campaignId, mapId, userId, cellsNow, epochAtStart);
  } catch (error) {
    if (isExplorationEpochConflict(error)) {
      // Upsert rolled back. Reset's deleteMany and empty broadcast are the
      // correction; an unlocked delete here can wipe a post-reset reveal.
      return;
    }
    logger.error('exploration:reveal failed', { err: error });
  } finally {
    queued.writing = false;
    if (queuedCellCount(queued) > 0) {
      scheduleRevealWrite(io, key, queued);
    } else {
      // Kept a second after its write, so the next report still waits its turn.
      setTimeout(() => {
        const idle = queuedReveals.get(key) === queued && !queued.timer && !queued.writing && queuedCellCount(queued) === 0;
        if (idle) queuedReveals.delete(key);
      }, REVEAL_WRITE_MS).unref?.();
    }
  }
}

/** Drop what is waiting to be written for a map, when the DM forgets its memory. */
function forgetQueuedReveals(mapId: string): void {
  for (const [key, queued] of queuedReveals) {
    if (queued.mapId !== mapId) continue;
    if (queued.timer) clearTimeout(queued.timer);
    queued.timer = null;
    queued.cellsByActor.clear();
    if (!queued.writing) queuedReveals.delete(key);
  }
}

/** Drop this actor's queued cells on kick or role-change. Other actors on the same (map, user) queue are left. If none remain and not writing, the queue goes. If `writing`, the in-tx actor check still refuses that actor's upsert. */
function forgetQueuedRevealsForActor(userId: string, campaignId: string): void {
  for (const [key, queued] of queuedReveals) {
    if (queued.campaignId !== campaignId) continue;
    if (!queued.cellsByActor.has(userId)) continue;
    queued.cellsByActor.delete(userId);
    if (queuedCellCount(queued) > 0 || queued.writing) continue;
    if (queued.timer) clearTimeout(queued.timer);
    queued.timer = null;
    queuedReveals.delete(key);
  }
}

onLiveCampaignDrop(forgetQueuedRevealsForActor);

export function registerExplorationHandlers(io: Server, socket: AuthenticatedSocket): void {
  /**
   * exploration:reveal — a player's vision covered these cells; remember them (a DM may name another member with userId to record theirs).
   * Any member. Throttled to 40/s per user; over-limit reveals are dropped.
   * Written at most once a second per map and user (queueReveal).
   * A DM may name another member and write that player's memory: Player
   * Preview records what the previewed token has seen, so a table the DM
   * drives alone still accrues it. The user's whole memory is then sent to
   * their own sockets and to the DM sockets previewing them, so a preview
   * follows it live (broadcastExplorationState).
   */
  socket.on('exploration:reveal', async (data: unknown) => {
    try {
      if (!socket.campaignId || !socket.userId) return;
      const campaignId = socket.campaignId;
      if (!explorationRevealLimiter.check(limiterKey(socket), REVEALS_PER_SECOND, 1000)) return;

      const parsed = ExplorationRevealSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { message: parsed.error.issues[0]?.message ?? 'Invalid exploration data' });
        return;
      }
      const { mapId, cells, userId: named } = parsed.data;

      // A prepared map is the DM's until they switch to it, for writes as
      // for reads (canReadMap). A report is sent by the page on its own and
      // can cross a map switch, or memory being turned off, in flight, so
      // one that no longer applies is dropped without an error: the page
      // shows socket errors in the dice panel.
      const map = await prisma.map.findUnique({ where: { id: mapId }, select: MAP_SELECT });
      if (!map || map.campaignId !== campaignId || !canReadMap(socket.role, mapId, map.campaign.currentMapId)) return;
      if (!map.explorationEnabled) return;
      // A map stored before the size limits can be too large to remember.
      // exploration:request says so; this one is sent by the page as vision
      // moves, so it is dropped without a word.
      if (!fogFits(map)) return;

      let userId = socket.userId;
      if (named !== undefined && named !== socket.userId) {
        if (socket.role !== 'DM') {
          socket.emit('error', { message: 'You can only record your own explored memory' });
          return;
        }
        const member = await prisma.campaignMembership.findUnique({
          where: { userId_campaignId: { userId: named, campaignId } },
          select: { userId: true },
        });
        if (!member) {
          socket.emit('error', { message: 'That user is not a member of this campaign' });
          return;
        }
        userId = named;
      }

      const authz = await confirmWriteAuthorization(socket, { campaignId });
      if (!authz.ok) return;
      if (!canReadMap(authz.role, mapId, map.campaign.currentMapId)) return;
      if (userId !== socket.userId && authz.role !== 'DM') {
        socket.emit('error', { message: 'You can only record your own explored memory' });
        return;
      }
      queueReveal(io, campaignId, mapId, userId, cells, socket.userId);
    } catch (error) {
      logger.error('exploration:reveal failed', { err: error });
    }
  });

  /**
   * exploration:request — what this user has explored on a map. A DM may name
   * another user, for Player Preview; anyone else gets their own.
   */
  socket.on('exploration:request', async (data: { mapId?: unknown; userId?: unknown }) => {
    try {
      if (!socket.campaignId || !socket.userId) return;
      const userId = socket.role === 'DM' && typeof data?.userId === 'string' ? data.userId : socket.userId;
      // A DM naming a player is previewing them: that player's memory is
      // the one this socket follows from now on (broadcastExplorationState).
      // Before the limit, so a preview switched faster than it allows still
      // follows the player now shown; it reads nothing.
      if (socket.role === 'DM') socket.previewingMemoryOf = userId === socket.userId ? undefined : userId;
      if (!stateRequestAllowed(socket, 'exploration:request')) return;
      const mapId = typeof data?.mapId === 'string' ? data.mapId : null;
      if (!mapId) return;

      const map = await prisma.map.findUnique({ where: { id: mapId }, select: MAP_SELECT });
      if (!map || map.campaignId !== socket.campaignId) return;
      // A prepared map is the DM's alone; a player is answered only about
      // the map the campaign is showing.
      if (!canReadMap(socket.role, mapId, map.campaign.currentMapId)) return;
      if (!map.explorationEnabled) return;

      // Shared explored-memory lock: cannot observe a row a reset/write is
      // mid-replacing. Two-argument key, so this does not stall token/fog JSON.
      const snapshot = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${mapId}), hashtext('explored-memory'))`;
        const row = await tx.mapExploration.findUnique({
          where: { mapId_userId: { mapId, userId } },
          select: { explored: true },
        });
        const explored: FogState = loadFogState(map, (row?.explored as FogState | null) ?? null);
        return { cells: revealedCellIndices(explored), epoch: explorationEpochFor(mapId) };
      });
      socket.emit('exploration:state', {
        mapId,
        userId,
        cells: snapshot.cells,
        epoch: snapshot.epoch,
      });
    } catch (error) {
      if (error instanceof FogTooLargeError) {
        socket.emit('error', { message: error.message });
        return;
      }
      logger.error('exploration:request failed', { err: error });
    }
  });

  /**
   * exploration:reset — DM forgets every player's explored areas on a map.
   * Increments only this map's explored-memory epoch, under the same
   * explored-memory advisory lock as a reveal write, so forgotten cells
   * cannot land after deleteMany. Does not take the map JSON lock, and does
   * not touch tokens, fog, or pings, or bump join or current-map identity.
   */
  socket.on('exploration:reset', async (data: { mapId?: unknown }) => {
    try {
      if (!socket.campaignId) return;
      const campaignId = socket.campaignId;
      if (!withinCeiling(socket, 'exploration:reset')) return;
      if (socket.role !== 'DM') {
        socket.emit('error', { message: 'Only DMs can reset explored areas' });
        return;
      }
      const mapId = typeof data?.mapId === 'string' ? data.mapId : null;
      if (!mapId) {
        socket.emit('error', { message: 'mapId required' });
        return;
      }
      const map = await prisma.map.findUnique({ where: { id: mapId }, select: { campaignId: true } });
      if (!map || map.campaignId !== campaignId) {
        socket.emit('error', { message: 'Map not found' });
        return;
      }
      const authz = await confirmWriteAuthorization(socket, { campaignId });
      if (!authz.ok) return;
      if (authz.role !== 'DM') {
        socket.emit('error', { message: 'Only DMs can reset explored areas' });
        return;
      }
      const epoch = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${mapId}), hashtext('explored-memory'))`;
        const next = bumpExplorationEpoch(mapId);
        forgetQueuedReveals(mapId);
        await tx.mapExploration.deleteMany({ where: { mapId } });
        return next;
      });
      await emitToMapReaders(io, campaignId, mapId, 'exploration:state', {
        mapId,
        userId: null,
        cells: [],
        epoch,
      });
    } catch (error) {
      logger.error('exploration:reset failed', { err: error });
      socket.emit('error', { message: 'Failed to reset explored areas' });
    }
  });
}
