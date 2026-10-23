// ============================================
// Character handlers: character.hp.update, character.hitdice.spend
// Players act on their own characters; the DM may act on any of them.
// ============================================

import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../auth';
import { prisma } from '../../config/database';
import logger from '../../utils/logger';
import { toJson } from '../../utils/prisma-json';
import { projectCharacterData } from '../../utils/sheetProjection';
import type { DnD5eHitDice } from '../../game-systems/dnd5e';
import { GAME_SYSTEM_SHEET_FROZEN_MESSAGE, isGameSystemSheetFrozen } from '../../game-systems';
import { withinCeiling } from '../shared';
import { emitCharacterUpdated } from '../utils';
import { applyWriteAuthzDrop, confirmWriteAuthorization } from '../writeAuthz';
import { acceptLiveSheetPatch } from '../../utils/prepareSheet';

/** The parts of a character blob this handler touches — see `charData` below. */
interface HpBlock {
  current?: unknown;
  maximum?: unknown;
  temporary?: unknown;
}
/** One hit dice pool as it sits in the blob, read loosely: only `remaining` is touched. */
type HitDiceEntry = Partial<Record<keyof DnD5eHitDice, unknown>>;
interface CharacterHitDiceData {
  hitDice?: unknown;
  [key: string]: unknown;
}
interface CharacterHpData {
  /** D&D 5e and Pathfinder 2e keep HP at the top level. */
  hp?: HpBlock;
  /** Call of Cthulhu 7e keeps it under derived stats. */
  derivedStats?: { hp?: HpBlock };
  [key: string]: unknown;
}

type Refusal = { error: string };

/**
 * The sheet with `delta` applied to its current hit points, clamped to 0 and
 * the projected maximum, or why it cannot be.
 *
 * Roster and map bars use this event; a stale stored max must not clamp away
 * current HP. Projection is for the clamp and the payload `max` only: current
 * resources are writes, so derived fields stay as stored.
 *
 * Only the HP-bearing corners of the sheet are described: the blob is a full
 * character in one of several systems, and nothing else is read or written.
 * The values stay `unknown` until the checks below establish they are numbers.
 */
function applyHpDelta(
  gameSystem: string | null,
  stored: unknown,
  delta: number
): { data: CharacterHpData; hp: { current: number; max: number; temp: number } } | Refusal {
  const charData = stored as CharacterHpData;
  const projected = projectCharacterData(gameSystem, stored) as CharacterHpData;
  switch (gameSystem) {
    case 'DND_5E':
    case 'PATHFINDER_2E': {
      if (!charData?.hp || typeof charData.hp.maximum !== 'number') {
        return { error: 'Character does not have HP tracking' };
      }
      const projectedMax = projected?.hp?.maximum;
      const max = typeof projectedMax === 'number' && Number.isFinite(projectedMax) ? projectedMax : charData.hp.maximum;
      const temp = typeof charData.hp.temporary === 'number' ? charData.hp.temporary : 0;
      const current = Math.max(0, Math.min(max, (typeof charData.hp.current === 'number' ? charData.hp.current : max) + delta));
      return { data: { ...charData, hp: { ...charData.hp, current } }, hp: { current, max, temp } };
    }
    case 'CALL_OF_CTHULHU_7E': {
      if (!charData?.derivedStats?.hp || typeof charData.derivedStats.hp.maximum !== 'number') {
        return { error: 'Character does not have HP tracking' };
      }
      const projectedMax = projected?.derivedStats?.hp?.maximum;
      const max = typeof projectedMax === 'number' && Number.isFinite(projectedMax) ? projectedMax : charData.derivedStats.hp.maximum;
      const current = Math.max(0, Math.min(max, (typeof charData.derivedStats.hp.current === 'number' ? charData.derivedStats.hp.current : max) + delta));
      return {
        data: { ...charData, derivedStats: { ...charData.derivedStats, hp: { ...charData.derivedStats.hp, current } } },
        hp: { current, max, temp: 0 },
      };
    }
    default:
      return { error: 'HP tracking not supported for this game system' };
  }
}

/** The sheet with one die spent from the pool at `index`, or why it cannot be. */
function spendHitDie(stored: unknown, index: number): { data: CharacterHitDiceData } | Refusal {
  const charData = stored as CharacterHitDiceData;
  const pools = Array.isArray(charData?.hitDice) ? (charData.hitDice as HitDiceEntry[]) : null;
  if (!pools || !pools[index]) return { error: 'No hit dice pool at that position' };
  const remaining = typeof pools[index].remaining === 'number' ? (pools[index].remaining as number) : 0;
  if (remaining <= 0) return { error: 'No hit dice remaining to spend' };
  const hitDice = pools.map((entry, at) => (at === index ? { ...entry, remaining: remaining - 1 } : entry));
  return { data: { ...charData, hitDice } };
}

export function registerCharacterHandlers(io: Server, socket: AuthenticatedSocket): void {
  /**
   * CHARACTER.HP.UPDATE — apply a hit-point delta; clamp and broadcast use
   * the projected maximum when inputs exist; only current is written; a frozen
   * Shadowrun 6e sheet is refused.
   */
  socket.on('character.hp.update', async (data: { characterId: string; delta: number }) => {
    try {
      if (!socket.campaignId) {
        socket.emit('error', { message: 'Not authenticated to a campaign' });
        return;
      }
      const campaignId = socket.campaignId;

      // Each change holds the character's row for a transaction, so a burst
      // of them would hold every database connection the instance has.
      if (!withinCeiling(socket, 'character.hp.update')) return;

      const { characterId, delta } = data;

      if (!characterId || typeof delta !== 'number' || !Number.isInteger(delta) || !Number.isFinite(delta)) {
        socket.emit('error', { message: 'characterId (string) and delta (integer) are required' });
        return;
      }

      // Fetch the character
      const character = await prisma.character.findUnique({
        where: { id: characterId },
      });

      if (!character) {
        socket.emit('error', { message: 'Character not found' });
        return;
      }

      // Verify character belongs to this campaign
      const membership = await prisma.campaignMembership.findFirst({
        where: { campaignId, characterIds: { has: characterId } },
      });

      if (!membership) {
        socket.emit('error', { message: 'Character is not in this campaign' });
        return;
      }

      // A spectator is watching, not playing: not even a character they own,
      // since a token bound to it follows the sheet on every screen. The DM
      // can still cover for them.
      if (socket.role === 'SPECTATOR') {
        socket.emit('error', { message: 'Spectators cannot change a character' });
        return;
      }

      // Permission: character owner or DM
      if (character.userId !== socket.userId && socket.role !== 'DM') {
        socket.emit('error', { message: 'You do not have permission to update this character\'s HP' });
        return;
      }

      // Frozen sheets stay readable; live resource patches wait for a sheet
      // and an attribution section (ADR 0013). Check after permission so a
      // stranger still hears they may not touch the character.
      if (isGameSystemSheetFrozen(character.gameSystem)) {
        socket.emit('error', { message: GAME_SYSTEM_SHEET_FROZEN_MESSAGE });
        return;
      }

      // Read and written under the row's lock, afresh. Reading before the
      // lock and writing the whole sheet back undid any save that landed in
      // between; a save arriving now waits for this one instead. Session and
      // MFA are confirmed before the lock; membership is re-read through the
      // transaction so a kick or demotion cannot persist HP (ADR 0007).
      const pre = await confirmWriteAuthorization(socket, { campaignId });
      if (!pre.ok) return;
      const outcome = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
        const authz = await confirmWriteAuthorization(socket, { db: tx, campaignId });
        if (!authz.ok) return { denied: true, dropCampaign: authz.dropCampaign, campaignId: authz.campaignId } as const;
        if (authz.role === 'SPECTATOR') return { error: 'Spectators cannot change a character' } as const;
        const fresh = await tx.character.findUnique({
          where: { id: characterId },
          select: { data: true, userId: true, gameSystem: true, campaignId: true },
        });
        if (!fresh) return { error: 'Character not found' } as const;
        if (fresh.campaignId !== campaignId) return { error: 'Character is not in this campaign' } as const;
        if (fresh.userId !== socket.userId && authz.role !== 'DM') {
          return { error: 'You do not have permission to update this character\'s HP' } as const;
        }
        if (isGameSystemSheetFrozen(fresh.gameSystem)) {
          return { error: GAME_SYSTEM_SHEET_FROZEN_MESSAGE } as const;
        }
        const applied = applyHpDelta(fresh.gameSystem, fresh.data, delta);
        if ('error' in applied) return applied;
        const accepted = acceptLiveSheetPatch({
          gameSystem: fresh.gameSystem,
          original: fresh.data,
          patched: applied.data,
        });
        if (!accepted.ok) return { error: accepted.message };
        await tx.character.update({ where: { id: characterId }, data: { data: toJson(accepted.data) } });
        return applied;
      });
      if ('denied' in outcome) {
        await applyWriteAuthzDrop(socket, outcome);
        return;
      }
      if ('error' in outcome) {
        socket.emit('error', { message: outcome.error });
        return;
      }
      const { current, max, temp } = outcome.hp;

      // Broadcast updated HP to all campaign members
      io.to(campaignId).emit('character.hp.updated', {
        characterId,
        hp: { current, max, temp },
      });

    } catch (error) {
      logger.error('character.hp.update failed', { err: error });
      socket.emit('error', { message: 'Failed to update character HP' });
    }
  });

  /**
   * CHARACTER.HITDICE.SPEND — spend one D&D 5e hit die; a frozen Shadowrun 6e
   * sheet is refused.
   *
   * The roll itself goes through `dice.roll` like every other roll; this only
   * decrements the pool, so the count cannot be inflated by a client that
   * simply declines to send it. Same permission rule as HP: the character's
   * owner, or the DM covering for an absent player.
   */
  socket.on('character.hitdice.spend', async (data: { characterId: string; index: number }) => {
    try {
      if (!socket.campaignId) {
        socket.emit('error', { message: 'Not authenticated to a campaign' });
        return;
      }
      const campaignId = socket.campaignId;

      if (!withinCeiling(socket, 'character.hitdice.spend')) return;

      const { characterId, index } = data ?? {};

      if (!characterId || typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        socket.emit('error', { message: 'characterId (string) and index (integer) are required' });
        return;
      }

      const character = await prisma.character.findUnique({ where: { id: characterId } });
      if (!character) {
        socket.emit('error', { message: 'Character not found' });
        return;
      }

      const membership = await prisma.campaignMembership.findFirst({
        where: { campaignId, characterIds: { has: characterId } },
      });
      if (!membership) {
        socket.emit('error', { message: 'Character is not in this campaign' });
        return;
      }

      // As for hit points: a spectator changes nothing, the DM may.
      if (socket.role === 'SPECTATOR') {
        socket.emit('error', { message: 'Spectators cannot change a character' });
        return;
      }

      if (character.userId !== socket.userId && socket.role !== 'DM') {
        socket.emit('error', { message: 'You do not have permission to spend this character\'s hit dice' });
        return;
      }

      if (isGameSystemSheetFrozen(character.gameSystem)) {
        socket.emit('error', { message: GAME_SYSTEM_SHEET_FROZEN_MESSAGE });
        return;
      }

      if (character.gameSystem !== 'DND_5E') {
        socket.emit('error', { message: 'Hit dice are not tracked for this game system' });
        return;
      }

      // Under the row's lock and read afresh, for the reason given for hit
      // points above. Session and MFA are confirmed before the lock;
      // membership is re-read through the transaction so a PLAYER demoted
      // to SPECTATOR mid-write cannot land a hit die.
      const pre = await confirmWriteAuthorization(socket, { campaignId });
      if (!pre.ok) return;
      const outcome = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
        const authz = await confirmWriteAuthorization(socket, { db: tx, campaignId });
        if (!authz.ok) return { denied: true, dropCampaign: authz.dropCampaign, campaignId: authz.campaignId } as const;
        if (authz.role === 'SPECTATOR') return { error: 'Spectators cannot change a character' } as const;
        const fresh = await tx.character.findUnique({
          where: { id: characterId },
          select: { data: true, userId: true, gameSystem: true, campaignId: true },
        });
        if (!fresh) return { error: 'Character not found' } as const;
        if (fresh.campaignId !== campaignId) return { error: 'Character is not in this campaign' } as const;
        if (fresh.userId !== socket.userId && authz.role !== 'DM') {
          return { error: 'You do not have permission to spend this character\'s hit dice' } as const;
        }
        if (isGameSystemSheetFrozen(fresh.gameSystem)) {
          return { error: GAME_SYSTEM_SHEET_FROZEN_MESSAGE } as const;
        }
        if (fresh.gameSystem !== 'DND_5E') {
          return { error: 'Hit dice are not tracked for this game system' } as const;
        }
        const spent = spendHitDie(fresh.data, index);
        if ('error' in spent) return spent;
        const accepted = acceptLiveSheetPatch({
          gameSystem: fresh.gameSystem,
          original: fresh.data,
          patched: spent.data,
        });
        if (!accepted.ok) return { error: accepted.message };
        return { updated: await tx.character.update({ where: { id: characterId }, data: { data: toJson(accepted.data) } }) };
      });
      if ('denied' in outcome) {
        await applyWriteAuthzDrop(socket, outcome);
        return;
      }
      if ('error' in outcome) {
        socket.emit('error', { message: outcome.error });
        return;
      }
      const updated = outcome.updated;

      // The sheet blob changed, so this goes out as `character.updated` — the
      // event an open character sheet already refreshes on — rather than a
      // narrow one of its own that nothing would listen to. No token art or
      // name changed, so nothing needs to repaint the map.
      // The sheet as each member may read it: the Keeper's Notes to the DM alone.
      await emitCharacterUpdated(campaignId, updated, {
        characterId,
        userId: socket.userId,
        tokensChanged: false,
      });

    } catch (error) {
      logger.error('character.hitdice.spend failed', { err: error });
      socket.emit('error', { message: 'Failed to spend hit die' });
    }
  });
}
