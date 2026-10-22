/**
 * Join-time game-system checks that must see a committed Campaign.gameSystem.
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
 */

import type { Prisma } from '@prisma/client';
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

/** Refuse a Character whose game system may not join this Campaign. */
export function assertCompatible(
  characterSystem: string | null | undefined,
  campaignSystem: string | null | undefined,
): void {
  if (!systemsCompatible(characterSystem, campaignSystem)) {
    throw new GameSystemMismatchError(characterSystem, campaignSystem);
  }
}
