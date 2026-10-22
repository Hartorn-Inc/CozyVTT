/**
 * Join-time writes that must see a committed Campaign.gameSystem and, for
 * create-in and assign, a live CampaignMembership seat. Kick locks that same
 * seat before it clears Character.campaignId.
 *
 * Create-in, assign, and invitation-accept used to read Campaign.gameSystem
 * outside the write, then write the Character. A concurrent PUT can change
 * the Campaign's system in that gap and leave a Character newly assigned
 * into a typed Campaign it does not match — a join ADR 0015 refuses.
 * Campaign PUT may still change the system under Characters already there;
 * that path is logged and is not this one.
 *
 * Character.gameSystem cannot change after create, so the lock is the
 * Campaign row. Keep `systemsCompatible` as the predicate; this file is
 * backend-only so the shared copy stays byte-identical with the frontend.
 *
 * Create-in and assign also used to check membership outside the write, then
 * skip `characterIds` if the seat was gone inside the transaction while still
 * writing `Character.campaignId`. A concurrent kick can clear campaignId and
 * delete the membership without taking Campaign FOR UPDATE, so it can finish
 * while a join waits on (or holds) the Campaign row. After locking Campaign,
 * those two paths lock and revalidate the caller's CampaignMembership; a gone
 * seat is 403 and rolls back. Invitation-accept creates the membership, so it
 * only takes the Campaign lock.
 *
 * Assign then locks the Character. Two concurrent assigns of the same
 * unassigned Character to different campaigns used to both see campaignId
 * null (loaded before the transaction), append the id to both memberships,
 * and both UPDATE the column: the leftover roster entry stayed on the
 * campaign that lost the write. FOR UPDATE waits, then the write uses that
 * campaignId for previous-membership removal and the column.
 *
 * Kick used to updateMany characters then delete the seat. If a join already
 * held membership, updateMany matched zero rows and did not wait; DELETE
 * waited; the join wrote campaignId and committed; kick deleted the seat —
 * leftover `Character.campaignId` again. Kick now FOR UPDATE the membership
 * before updateMany. It does not take Campaign FOR UPDATE after the seat
 * (join is Campaign then membership; the reverse deadlocks). Assign's
 * Character lock comes after that same membership, matching kick
 * (membership then Character).
 */

import type { CampaignRole, Prisma } from '@prisma/client';
import { systemsCompatible } from './gameSystemCompatibility';

/** A new join into a typed Campaign of another system. */
export class GameSystemMismatchError extends Error {
  readonly error = 'Game System Mismatch';

  constructor(characterSystem: string | null | undefined, campaignSystem: string | null | undefined) {
    const charLabel = characterSystem ?? 'flexible';
    const campLabel = campaignSystem ?? 'flexible';
    super(
      `Cannot assign a ${charLabel} character to a ${campLabel} campaign. Character and campaign game systems must match.`,
    );
    this.name = 'GameSystemMismatchError';
  }
}

/** The Campaign row disappeared after the route had already looked it up. */
export class CampaignGoneError extends Error {
  constructor() {
    super('Campaign not found');
    this.name = 'CampaignGoneError';
  }
}

/**
 * This userId's CampaignMembership row disappeared after the route had
 * already looked it up. Create-in and assign map it to 403; kick maps it
 * to 404 with that path's existing message.
 */
export class MembershipGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MembershipGoneError';
  }
}

/** The Character row disappeared after the route had already looked it up. */
export class CharacterGoneError extends Error {
  constructor() {
    super('Character not found');
    this.name = 'CharacterGoneError';
  }
}

/**
 * Lock the Campaign row and return its current gameSystem.
 *
 * `SELECT ... FOR UPDATE` waits for a concurrent PUT (or another join) that
 * holds the row, then this read sees the committed system. A missing
 * Campaign is not a 500: the route turns `CampaignGoneError` into 404.
 */
export async function lockCampaignGameSystem(
  tx: Prisma.TransactionClient,
  campaignId: string,
): Promise<string | null> {
  await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`;
  const campaign = await tx.campaign.findUnique({
    where: { id: campaignId },
    select: { gameSystem: true },
  });
  if (!campaign) throw new CampaignGoneError();
  return campaign.gameSystem;
}

/**
 * Lock this userId's CampaignMembership row and return its characterIds and role.
 *
 * `SELECT ... FOR UPDATE` waits for a concurrent join or kick that holds the
 * seat, then this read sees whether the membership still exists. A missing
 * seat throws `MembershipGoneError` (create-in/assign → 403, kick → 404).
 *
 * Join paths call this after `lockCampaignGameSystem` (Campaign, then
 * membership). Assign then locks the Character. Kick does not take Campaign
 * FOR UPDATE after the seat.
 */
export async function lockCampaignMembership(
  tx: Prisma.TransactionClient,
  userId: string,
  campaignId: string,
  goneMessage: string,
): Promise<{ characterIds: string[]; role: CampaignRole }> {
  await tx.$queryRaw`SELECT id FROM "CampaignMembership" WHERE "userId" = ${userId} AND "campaignId" = ${campaignId} FOR UPDATE`;
  const membership = await tx.campaignMembership.findUnique({
    where: { userId_campaignId: { userId, campaignId } },
    select: { characterIds: true, role: true },
  });
  if (!membership) throw new MembershipGoneError(goneMessage);
  return membership;
}

/**
 * Lock the Character row and return its current campaignId.
 *
 * Assign calls this after Campaign then membership. Concurrent assigns of
 * the same Character serialize here so the loser sees the committed
 * campaignId and can strip the id from that previous membership. A missing
 * Character is not a 500: the route turns `CharacterGoneError` into 404.
 *
 * Do not FOR UPDATE another campaign's membership after this lock: kick of
 * that campaign is membership then Character, and the reverse deadlocks.
 */
export async function lockCharacterCampaignId(
  tx: Prisma.TransactionClient,
  characterId: string,
): Promise<string | null> {
  await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
  const character = await tx.character.findUnique({
    where: { id: characterId },
    select: { campaignId: true },
  });
  if (!character) throw new CharacterGoneError();
  return character.campaignId;
}

/** Refuse a Character whose game system may not join this Campaign. */
export function assertCompatible(
  characterSystem: string | null | undefined,
  campaignSystem: string | null | undefined,
): void {
  if (!systemsCompatible(characterSystem, campaignSystem)) {
    throw new GameSystemMismatchError(characterSystem, campaignSystem);
  }
}
