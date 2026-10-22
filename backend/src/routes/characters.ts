import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/rbac';
import { authenticated } from '../middleware/compose';
import { prisma } from '../config/database';
import type { CampaignRole, Prisma } from '@prisma/client';
import { normalizeAssetUrl } from '../utils/asset-urls';
import { canReferenceAsset } from '../services/permissions';
import { GameSystem, gameSystemSheetFrozenError, isGameSystemSheetFrozen } from '../game-systems';
import { validateCharacterData, sheetNameFor } from '../validators/game-systems';
import { CreateCharacterSchema, UpdateCharacterSchema } from '../validators/characters';
import { broadcastToCampaign, emitCharacterUpdated } from '../websocket/utils';
import {
  characterForReader, clearKeeperNotes, hasKeeperNotes, isKeeperOf, sheetKeepingKeeperNotes, sheetWithoutKeeperNotes,
} from '../utils/keeperNotes';
import { resendInitiative } from '../websocket/handlers/initiative';
import logger from '../utils/logger';
import { cutText } from '../utils/cutText';
import { readTokens, toJson } from '../utils/prisma-json';
import { extractCharacterHp, sameCharacterHp } from '../utils/characterHp';
import { prepareSheetForStorage, sheetRecord, type SheetIssue } from '../utils/prepareSheet';
import { projectCharacterData } from '../utils/sheetProjection';
import { withMapsLocked } from '../utils/mapTokens';
import {
  assertCompatible,
  CampaignGoneError,
  CHARACTER_CAMPAIGN_WRITE_ATTEMPTS,
  CharacterGoneError,
  GameSystemMismatchError,
  lockCampaignGameSystem,
  lockCampaignMembership,
  lockCampaignMembershipsInSortedOrder,
  lockCharacterCampaignId,
  MembershipGoneError,
  StaleCampaignHintError,
} from '../utils/gameSystemMatchWrite';
import { holdOwnerCreates } from '../utils/ownerLimit';
import { getCharacterTemplate } from '../utils/character-templates';
import { FLEXIBLE_TEMPLATES } from '../utils/character-templates/flexible-templates';

const router = Router();

/**
 * The most characters one account may own, copies included. Each one can be
 * up to the 1 MB body limit. A player keeps a handful and a DM who builds
 * sheets for a table in advance a few dozen; 1,000 is far above either.
 */
export const MAX_CHARACTERS_PER_USER = 1000;
const CHARACTER_LIMIT_REACHED =
  `You already have ${MAX_CHARACTERS_PER_USER} characters, the most one account can. ` +
  'Delete one you no longer need to make room.';
const CREATE_IN_NOT_A_MEMBER =
  'You must be a member of the campaign to create a character in it';
const ASSIGN_NOT_A_MEMBER =
  'You must be a member of the campaign to assign a character to it';

/** Refused inside a create's transaction when the owner is at the ceiling. */
class CharacterLimitReached extends Error {}

/**
 * Create-in sheet validation failed. Mapped to the same 400 envelope as the
 * outer fast-fail so an in-transaction re-validate is not a 500.
 */
class SheetValidationError extends Error {
  readonly error = 'Validation Error';
  readonly validationErrors?: SheetIssue[];

  constructor(message: string, validationErrors?: SheetIssue[]) {
    super(message);
    this.name = 'SheetValidationError';
    this.validationErrors = validationErrors;
  }
}

/**
 * Create-in inherit resolved to a frozen system at commit. Mapped to the same
 * 400 envelope as the outer freeze check.
 */
class FrozenSheetError extends Error {
  constructor() {
    super(gameSystemSheetFrozenError().message);
    this.name = 'FrozenSheetError';
  }
}

/** Inside a create's transaction: refuse when the owner already has the most characters allowed. */
async function roomForCharacter(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await holdOwnerCreates(tx, 'characters', userId);
  if ((await tx.character.count({ where: { userId } })) >= MAX_CHARACTERS_PER_USER) {
    throw new CharacterLimitReached();
  }
}

/** The longest a character name may be, as the create and update schemas hold it. */
const MAX_CHARACTER_NAME_LENGTH = 200;
const COPY_SUFFIX = ' (Copy)';

/** A copy's name: the original's with " (Copy)", cut so the whole stays a name the editor can save. */
export function copyName(original: string): string {
  return `${cutText(original, MAX_CHARACTER_NAME_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
}

/**
 * What the list returns for each character: everything but the sheet, which
 * GET /:id serves. The list is unpaged, and every sheet can be up to the 1 MB
 * body limit.
 */
const CHARACTER_SUMMARY_SELECT = {
  id: true,
  userId: true,
  campaignId: true,
  gameSystem: true,
  name: true,
  tokenImageUrl: true,
  createdAt: true,
  updatedAt: true,
  campaign: { select: { id: true, name: true } },
} as const;

/**
 * Whether a character's owner is still a member of the campaign it names. A
 * member removed before removals took their characters out of the campaign
 * left characters naming it; those are the owner's alone.
 */
async function ownerStillIn(ownerId: string, campaignId: string): Promise<boolean> {
  const owner = await prisma.campaignMembership.findUnique({
    where: { userId_campaignId: { userId: ownerId, campaignId } },
    select: { userId: true },
  });
  return owner !== null;
}

const CHARACTER_CAMPAIGN_INCLUDE = {
  campaign: {
    select: {
      id: true,
      name: true,
      gameSystem: true,
    },
  },
} as const;

/**
 * Assign or unassign Character.campaignId and the matching membership
 * characterIds arrays in one transaction. Memberships (previous and target)
 * are locked in sorted campaignId order before Character so this write never
 * waits on a membership after taking the Character lock — kick of a campaign
 * is membership then Character, and the reverse deadlocks. If the locked
 * Character.campaignId is not the hint used to choose those seats, the
 * attempt aborts and retries with a fresh hint rather than locking a newly
 * discovered previous seat after Character. The locked target membership
 * role is returned for the HTTP response; unassign has no target (null).
 */
async function writeCharacterCampaignAssignment(params: {
  characterId: string;
  userId: string;
  characterGameSystem: string | null;
  hintedPreviousCampaignId: string | null;
  targetCampaignId: string | null;
}): Promise<{
  character: Prisma.CharacterGetPayload<{ include: typeof CHARACTER_CAMPAIGN_INCLUDE }>;
  previousCampaignId: string | null;
  targetRole: CampaignRole | null;
}> {
  const { characterId, userId, characterGameSystem, targetCampaignId } = params;
  let hintedPreviousCampaignId = params.hintedPreviousCampaignId;

  for (let attempt = 1; attempt <= CHARACTER_CAMPAIGN_WRITE_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (targetCampaignId) {
          const locked = await lockCampaignGameSystem(tx, targetCampaignId);
          // Character.gameSystem cannot change after create, so the outer
          // character.gameSystem is the same value a locked re-read would see.
          assertCompatible(characterGameSystem, locked);
        }

        const memberships = await lockCampaignMembershipsInSortedOrder(tx, userId, {
          previousCampaignId: hintedPreviousCampaignId,
          targetCampaignId,
          targetGoneMessage: ASSIGN_NOT_A_MEMBER,
        });

        const lockedCampaignId = await lockCharacterCampaignId(tx, characterId);
        if (lockedCampaignId !== hintedPreviousCampaignId) {
          throw new StaleCampaignHintError();
        }

        if (
          hintedPreviousCampaignId
          && hintedPreviousCampaignId !== targetCampaignId
          && memberships.previous
        ) {
          await tx.campaignMembership.update({
            where: {
              userId_campaignId: {
                userId,
                campaignId: hintedPreviousCampaignId,
              },
            },
            data: {
              characterIds: memberships.previous.characterIds.filter((cId) => cId !== characterId),
            },
          });
        }

        if (targetCampaignId && memberships.target && !memberships.target.characterIds.includes(characterId)) {
          await tx.campaignMembership.update({
            where: {
              userId_campaignId: {
                userId,
                campaignId: targetCampaignId,
              },
            },
            data: {
              characterIds: [...memberships.target.characterIds, characterId],
            },
          });
        }

        // Assign character to campaign. Coming from another campaign, or from
        // none, it leaves the Keeper's Notes behind: they are the last Keeper's,
        // and the owner may be this campaign's DM.
        if (lockedCampaignId !== targetCampaignId) await clearKeeperNotes(tx, characterId);
        const character = await tx.character.update({
          where: { id: characterId },
          data: { campaignId: targetCampaignId },
          include: CHARACTER_CAMPAIGN_INCLUDE,
        });
        return {
          character,
          previousCampaignId: lockedCampaignId,
          targetRole: memberships.target?.role ?? null,
        };
      });
    } catch (error) {
      if (!(error instanceof StaleCampaignHintError) || attempt >= CHARACTER_CAMPAIGN_WRITE_ATTEMPTS) {
        throw error;
      }
      const fresh = await prisma.character.findUnique({
        where: { id: characterId },
        select: { campaignId: true },
      });
      if (!fresh) throw new CharacterGoneError();
      hintedPreviousCampaignId = fresh.campaignId;
    }
  }

  throw new Error('Failed to assign character to campaign');
}


/**
 * Character Management Routes
 * Character Management
 */

/**
 * POST /api/characters
 * Create a new character
 * Requires: Authentication
 */
router.post('/', authenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;

    const parsed = CreateCharacterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: parsed.error.issues[0]?.message ?? 'Invalid character data',
      });
    }
    const { name, data, tokenImageUrl, gameSystem, campaignId } = parsed.data;

    // Determine final gameSystem value
    let finalGameSystem = gameSystem;
    let campaignGameSystem: string | null | undefined;

    // Creating straight into a campaign. Membership is checked here for a
    // 403, and `characterIds` is updated inside the write transaction,
    // because campaign membership is recorded in two places:
    // `Character.campaignId`, and the `characterIds` array on the member's
    // `CampaignMembership`. Nearly everything a player sees reads the second —
    // the roster is built from it, and services/permissions.ts asks it whether
    // a player may move a token. Writing only the column left a character that
    // was in the campaign but invisible in it, and whose own owner could not
    // move its token. POST /:id/assign has always written both; this mirrors it.
    if (campaignId) {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { gameSystem: true },
      });

      if (!campaign) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Campaign not found',
        });
      }

      const membership = await prisma.campaignMembership.findUnique({
        where: { userId_campaignId: { userId, campaignId } },
        select: { userId: true },
      });

      if (!membership) {
        return res.status(403).json({
          error: 'Forbidden',
          message: CREATE_IN_NOT_A_MEMBER,
        });
      }

      campaignGameSystem = campaign.gameSystem;

      // Inherit when omitted or null so create-in into a typed Campaign
      // without specifying a system still creates a matching Character, not
      // a Flexible sheet. Then refuse unless the resolved Character game
      // system is compatible with the Campaign (ADR 0015).
      if (!gameSystem) {
        // Prisma's GameSystem is a string-literal union; cast to the local enum
        // type finalGameSystem was inferred from (identical string values).
        finalGameSystem = campaign.gameSystem as GameSystem | null;
      }
    }

    // Frozen systems (ADR 0013): refuse create before sheet validation.
    // Explicit SHADOWRUN_6E uses this envelope even when the Campaign would
    // also mismatch. Inherit from a frozen Campaign is the same refusal.
    if (isGameSystemSheetFrozen(finalGameSystem)) {
      return res.status(400).json(gameSystemSheetFrozenError());
    }

    if (campaignId) {
      // Fast-fail before sheet validation. The write transaction locks the
      // Campaign and checks again against the committed gameSystem.
      try {
        assertCompatible(finalGameSystem, campaignGameSystem);
      } catch (error) {
        if (error instanceof GameSystemMismatchError) {
          return res.status(400).json({ error: error.error, message: error.message });
        }
        throw error;
      }
    }

    // Put the name the user typed, and their display name, into the sheet
    // itself. The sheet blob carries its own name field separate from the
    // `name` column, and nothing joined the two — so a character created as
    // "Aldra" opened showing the factory placeholder "New Character" with an
    // empty player name. Done here rather than in the modal so it also covers
    // copying a template and any API client. A Flexible sheet is checked as
    // sent: wrapping identity first would turn a string or a list into an
    // object before it could be refused.
    const owner = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    const displayName = owner?.displayName ?? '';
    // What gets stored: the schema's parsed output once validated, so a key
    // the sheet does not declare never reaches the database. A sheet in the
    // shape of a version before 1.3.0 has its older fields moved where the
    // sheet reads them first, since validation drops them.
    const prepared = finalGameSystem
      ? prepareSheetForStorage({
          gameSystem: finalGameSystem,
          data,
          identity: { name, playerDisplayName: displayName },
        })
      : prepareSheetForStorage({
          gameSystem: null,
          data: data === undefined ? {} : data,
        });
    if (!prepared.ok) {
      return res.status(400).json({
        error: 'Validation Error',
        message: prepared.message,
        validationErrors: prepared.validationErrors,
      });
    }
    let sheetData: unknown = prepared.data;
    // Keeper's Notes are written only by the Keeper: the DM of the campaign
    // the character is created in. Anyone else's are not stored. The pre-tx
    // read is the fast-fail; create-in re-reads the locked membership role
    // before storing and returning the sheet, so a concurrent DM transfer
    // cannot persist or return notes for a caller who is no longer DM.
    const keeper = await isKeeperOf(userId, campaignId || null);
    // Hoisted so the 201 uses the locked seat. With no campaignId,
    // isKeeperOf(..., null) is false and this stays false.
    let lockedKeeper = keeper;
    if (!keeper) {
      sheetData = sheetWithoutKeeperNotes((finalGameSystem as GameSystem | null | undefined) ?? null, sheetData);
    }

    // Normalize tokenImageUrl to full path if provided
    const normalizedTokenImageUrl = tokenImageUrl ? normalizeAssetUrl(tokenImageUrl, 'tokens') : null;

    // The image has to be one the caller may read. Storing an unchecked
    // reference is what let a member read a fellow member's private asset:
    // a character pointing at it counted as the campaign using it.
    if (!(await canReferenceAsset(normalizedTokenImageUrl, req.session.userId!))) {
      return res.status(403).json({ error: 'Forbidden', message: 'You do not have access to that image' });
    }

    // Both halves in one transaction. Written separately, a failure between
    // them would produce exactly the state this fixes: a character carrying a
    // campaignId that the campaign itself does not know about.
    const sheetValidatedAs = finalGameSystem ?? null;
    let storedGameSystem = finalGameSystem;
    const character = await prisma.$transaction(async (tx) => {
      let membershipCharacterIds: string[] | undefined;
      if (campaignId) {
        // Commit-time check: a concurrent campaign PUT can change gameSystem
        // after the fast-fail above. Lock the Campaign so this write sees the
        // committed system. Omitted or null gameSystem inherits that locked
        // row so the stored Character matches the Campaign at write; an
        // explicit sent system does not re-inherit (only assertCompatible).
        const locked = await lockCampaignGameSystem(tx, campaignId);
        if (!gameSystem) {
          storedGameSystem = locked as GameSystem | null;
        }
        if (isGameSystemSheetFrozen(storedGameSystem)) {
          throw new FrozenSheetError();
        }
        assertCompatible(storedGameSystem, locked);
        // A concurrent kick can delete the seat without taking Campaign
        // FOR UPDATE, so it can finish while this join waits on (or holds)
        // the Campaign row. Lock and revalidate membership before writing
        // Character.campaignId: a gone seat is 403 and rolls back, instead
        // of leaving a leftover campaignId the remaining members could treat
        // as in-campaign.
        const membership = await lockCampaignMembership(
          tx,
          userId,
          campaignId,
          CREATE_IN_NOT_A_MEMBER,
        );
        membershipCharacterIds = membership.characterIds;
        lockedKeeper = membership.role === 'DM';
        // Re-prep when omitted/null inherit sees a different locked Campaign
        // system, or when the locked seat is no longer DM. Always pass the
        // locked role, never the pre-tx keeper.
        if (lockedKeeper !== keeper || (!gameSystem && storedGameSystem !== sheetValidatedAs)) {
          const rePrepared = storedGameSystem
            ? prepareSheetForStorage({
                gameSystem: storedGameSystem,
                data,
                identity: { name, playerDisplayName: displayName },
              })
            : prepareSheetForStorage({
                gameSystem: null,
                data: data === undefined ? {} : data,
              });
          if (!rePrepared.ok) {
            throw new SheetValidationError(rePrepared.message, rePrepared.validationErrors);
          }
          sheetData = rePrepared.data;
          if (!lockedKeeper) {
            sheetData = sheetWithoutKeeperNotes(storedGameSystem ?? null, sheetData);
          }
        }
      }
      await roomForCharacter(tx, userId);
      const created = await tx.character.create({
        data: {
          userId,
          name,
          data: toJson(sheetData),
          tokenImageUrl: normalizedTokenImageUrl,
          campaignId: campaignId || null,
          gameSystem: storedGameSystem || null,
        },
      });

      if (campaignId && membershipCharacterIds && !membershipCharacterIds.includes(created.id)) {
        // Re-read after the membership lock is enough: concurrent create-ins
        // already serialize on Campaign then this seat, so a snapshot taken
        // before the transaction cannot clobber the array.
        await tx.campaignMembership.update({
          where: { userId_campaignId: { userId, campaignId } },
          data: { characterIds: [...membershipCharacterIds, created.id] },
        });
      }

      return created;
    });

    return res.status(201).json({
      message: 'Character created successfully',
      character: characterForReader(character, lockedKeeper),
    });
  } catch (error) {
    if (error instanceof CharacterLimitReached) {
      return res.status(400).json({ error: 'Validation Error', message: CHARACTER_LIMIT_REACHED });
    }
    if (error instanceof FrozenSheetError) {
      return res.status(400).json(gameSystemSheetFrozenError());
    }
    if (error instanceof SheetValidationError) {
      return res.status(400).json({
        error: error.error,
        message: error.message,
        ...(error.validationErrors ? { validationErrors: error.validationErrors } : {}),
      });
    }
    if (error instanceof GameSystemMismatchError) {
      return res.status(400).json({ error: error.error, message: error.message });
    }
    if (error instanceof CampaignGoneError) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Campaign not found',
      });
    }
    if (error instanceof MembershipGoneError) {
      return res.status(403).json({
        error: 'Forbidden',
        message: error.message,
      });
    }
    logger.error('Error creating character', { err: error });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create character',
    });
  }
});

/**
 * GET /api/characters
 * List all characters owned by the authenticated user, without their sheets
 * (GET /:id returns one with its sheet).
 * Requires: Authentication
 */
router.get('/', authenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;

    const characters = await prisma.character.findMany({
      where: { userId },
      select: CHARACTER_SUMMARY_SELECT,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return res.status(200).json({ characters });
  } catch (error) {
    logger.error('Error fetching characters', { err: error });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch characters',
    });
  }
});

/**
 * GET /api/characters/templates/:gameSystem/:templateName
 * Get a specific character template for a game system
 * Requires: Authentication
 * NOTE: This route MUST come before GET /:id to avoid route conflicts
 */
router.get(
  '/templates/:gameSystem/:templateName',
  authenticated,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { gameSystem, templateName } = req.params;

      // Handle flexible templates (no game system)
      if (!gameSystem || gameSystem === 'null' || gameSystem === 'undefined') {
        // Only the names defined there: the list is a plain object, so
        // `constructor` or `__proto__` would otherwise find an inherited one.
        const template = Object.hasOwn(FLEXIBLE_TEMPLATES, templateName)
          ? FLEXIBLE_TEMPLATES[templateName]
          : undefined;

        if (!template) {
          return res.status(404).json({
            error: 'Template Not Found',
            message: `Template '${templateName}' not found for flexible characters`,
          });
        }

        return res.status(200).json({
          message: 'Template retrieved successfully',
          ...template,
        });
      }

      // Validate game system
      if (!Object.values(GameSystem).includes(gameSystem as GameSystem)) {
        return res.status(400).json({
          error: 'Validation Error',
          message: `Invalid game system: ${gameSystem}`,
        });
      }

      // Get the template
      const template = getCharacterTemplate(gameSystem as GameSystem, templateName);

      return res.status(200).json({
        message: 'Template retrieved successfully',
        ...template,
      });
    } catch (error) {
      logger.error('Error fetching character template', { err: error });
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch character template',
      });
    }
  }
);

/**
 * GET /api/characters/:id
 * Get a specific character
 * Requires: Authentication
 * Authorization: Character owner OR campaign DM (if character is in a campaign)
 */
router.get('/:id', authenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { id } = req.params;

    const character = await prisma.character.findUnique({
      where: { id },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
        user: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            // SECURITY: never embed `email` — this endpoint can be hit by
            // any campaign member viewing another player's character.
          },
        },
      },
    });

    if (!character) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Character not found',
      });
    }

    // The reader's place in the character's campaign: whether they may read
    // it there, and whether they are its Keeper (its DM), who alone is sent
    // the Keeper's Notes.
    const membership = character.campaignId
      ? await prisma.campaignMembership.findUnique({
          where: {
            userId_campaignId: {
              userId,
              campaignId: character.campaignId,
            },
          },
        })
      : null;
    const keeper = membership?.role === 'DM';

    // Check authorization: owner can always view
    if (character.userId === userId) {
      return res.status(200).json({ character: characterForReader(character, keeper) });
    }

    // If character is in a campaign, check if requester is a campaign member
    // All campaign members can VIEW characters, but only owner/DM can EDIT
    // Any campaign member (DM, PLAYER, SPECTATOR) can view characters in
    // the campaign, while the owner is still a member of it.
    if (character.campaignId && membership && (await ownerStillIn(character.userId, character.campaignId))) {
      return res.status(200).json({ character: characterForReader(character, keeper) });
    }

    // Not authorized
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You do not have permission to view this character',
    });
  } catch (error) {
    logger.error('Error fetching character', { err: error });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch character',
    });
  }
});

/**
 * GET /api/characters/:id/validate
 * Validate character data against game system schema
 * Requires: Authentication
 * Authorization: Character owner only
 */
router.get('/:id/validate', authenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { id } = req.params;

    const character = await prisma.character.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        gameSystem: true,
        campaignId: true,
        data: true,
      },
    });

    if (!character) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Character not found',
      });
    }

    // Only character owner can validate (prevent info leakage)
    if (character.userId !== userId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to validate this character',
      });
    }

    // Cannot validate without a game system
    if (!character.gameSystem) {
      return res.status(400).json({
        isValid: false,
        errors: [{
          path: 'gameSystem',
          message: 'Character has no game system assigned',
          code: 'no_game_system',
        }],
      });
    }

    // The validator reports rather than throws; a bad sheet is a 200 with
    // the reasons, as documented, since asking is not an error.
    // Judged on the sheet as its owner is sent it: a report on the Keeper's
    // Notes would tell a player something of what is written there.
    const ownSheet = (await isKeeperOf(userId, character.campaignId))
      ? character.data
      : sheetWithoutKeeperNotes(character.gameSystem, character.data);
    const result = validateCharacterData(character.gameSystem as GameSystem, ownSheet);
    if (result.success) {
      return res.status(200).json({ isValid: true });
    }
    return res.status(200).json({
      isValid: false,
      errors: result.errors.issues.map((issue) => ({
        path: issue.path.join('.') || 'root',
        message: issue.message,
        code: issue.code,
      })),
    });
  } catch (error) {
    logger.error('Error validating character', { err: error });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to validate character',
    });
  }
});

/**
 * PUT /api/characters/:id
 * Update a character
 * Requires: Authentication
 * Authorization: Character owner OR campaign DM (if character is in a campaign)
 */
router.put('/:id', authenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { id } = req.params;

    const parsed = UpdateCharacterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: parsed.error.issues[0]?.message ?? 'Invalid character data',
      });
    }
    const { name, data, tokenImageUrl, gameSystem, updatedAt: loadedAt } = parsed.data;

    // Find character first to check authorization
    const character = await prisma.character.findUnique({
      where: { id },
    });

    if (!character) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Character not found',
      });
    }

    // Check authorization: the owner, or the DM of the character's campaign.
    // A spectator in that campaign may not edit even their own character: a
    // token bound to it follows the sheet on every screen (its bar, its
    // downed fade, its picture), and spectators change nothing at the table.
    const membership = character.campaignId
      ? await prisma.campaignMembership.findUnique({
          where: { userId_campaignId: { userId, campaignId: character.campaignId } },
        })
      : null;
    if (membership?.role === 'SPECTATOR') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Spectators cannot edit a character in this campaign',
      });
    }
    const isAuthorized =
      character.userId === userId ||
      (membership?.role === 'DM' && character.campaignId !== null && (await ownerStillIn(character.userId, character.campaignId)));
    // The Keeper (the DM of the character's campaign) alone reads and writes
    // the Keeper's Notes.
    const keeper = membership?.role === 'DM';

    if (!isAuthorized) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to edit this character',
      });
    }

    // Prevent changing gameSystem after creation. Checked after the permission
    // check, so the answer tells a stranger nothing about the character.
    if (gameSystem !== undefined && gameSystem !== character.gameSystem) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot change game system after character creation. Create a new character instead.',
      });
    }

    // Frozen systems (ADR 0013): sheet-data updates stay closed. Name-only
    // and tokenImageUrl-only PUTs still succeed. Strangers already 403'd.
    if (data !== undefined && isGameSystemSheetFrozen(character.gameSystem)) {
      return res.status(400).json(gameSystemSheetFrozenError());
    }

    // Validate the sheet against its game system's schema, or the Flexible
    // layout when it has none. What gets stored is the schema's parsed output,
    // so a key the sheet does not declare never reaches the database. A sheet
    // still carrying fields from before 1.3.0 has them moved where the sheet
    // reads them first, or that would drop their content before
    // `migrate:sheet-fields` could move it.
    let sheetData: unknown = data;
    if (data !== undefined) {
      const prepared = prepareSheetForStorage({
        gameSystem: character.gameSystem as GameSystem | null,
        data,
      });
      if (!prepared.ok) {
        return res.status(400).json({
          error: 'Validation Error',
          message: prepared.message,
          validationErrors: prepared.validationErrors,
        });
      }
      sheetData = prepared.data;
    }

    // Build update data
    const updateData: {
      name?: string;
      data?: Prisma.InputJsonValue;
      tokenImageUrl?: string | null;
    } = {};
    if (name !== undefined) updateData.name = name;
    // A save by anyone but the Keeper keeps the Keeper's Notes as stored,
    // whatever it sent for them.
    const keepsKeeperNotes = data !== undefined && !keeper && hasKeeperNotes(character.gameSystem);
    if (data !== undefined) {
      updateData.data = toJson(
        keepsKeeperNotes ? sheetKeepingKeeperNotes(character.gameSystem, sheetData, character.data) : sheetData
      );
    }

    // Keep the `name` column in step with the name typed on the sheet.
    //
    // A character carries its name twice — the column, which the gallery, the
    // roster and the editor's title bar read, and a field inside the sheet blob,
    // which is what the sheet's own input edits. Renaming on the sheet updated
    // only the blob, so everything outside the sheet went on showing the name
    // the character was created with. The sheet is the thing the user typed
    // into, so it wins; an explicit `name` in the request still takes priority.
    if (name === undefined && data !== undefined && character.gameSystem) {
      const sheetName = sheetNameFor(character.gameSystem as GameSystem, sheetData as Record<string, unknown>);
      if (sheetName && sheetName !== character.name) {
        updateData.name = sheetName;
      }
    }
    if (tokenImageUrl !== undefined) {
      // Normalize tokenImageUrl to full path (or null), and check what is stored
      const normalizedTokenImageUrl = tokenImageUrl ? normalizeAssetUrl(tokenImageUrl, 'tokens') : null;
      // The picture already on the sheet may be sent back as it is.
      if (!(await canReferenceAsset(normalizedTokenImageUrl, req.session.userId!, character.tokenImageUrl))) {
        return res.status(403).json({ error: 'Forbidden', message: 'You do not have access to that image' });
      }
      updateData.tokenImageUrl = normalizedTokenImageUrl;
    }

    const withCampaign = { campaign: { select: { id: true, name: true } } } as const;
    let updatedCharacter;
    if (loadedAt !== undefined) {
      // Saved only if the character is still the version the caller loaded.
      // Checked in the write itself, so a change landing after the read above
      // is caught too. Without it, a sheet open while the DM took hit points
      // put the old number back on its next save.
      const { count } = await prisma.character.updateMany({
        where: { id, updatedAt: new Date(loadedAt) },
        data: updateData,
      });
      if (count === 0) {
        return res.status(409).json({
          error: 'Conflict',
          code: 'CHARACTER_CHANGED',
          message: 'This character was changed after you loaded it. Load it again and make your change on the new version.',
        });
      }
      updatedCharacter = await prisma.character.findUniqueOrThrow({ where: { id }, include: withCampaign });
    } else if (keepsKeeperNotes) {
      // Saved whatever changed in between, so the notes kept are the ones
      // stored at the moment of the write, under the row's lock: a Keeper's
      // edit landing after the read above is not put back.
      updatedCharacter = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${id} FOR UPDATE`;
        const fresh = await tx.character.findUniqueOrThrow({ where: { id }, select: { data: true } });
        return tx.character.update({
          where: { id },
          data: { ...updateData, data: toJson(sheetKeepingKeeperNotes(character.gameSystem, sheetData, fresh.data)) },
          include: withCampaign,
        });
      });
    } else {
      updatedCharacter = await prisma.character.update({
        where: { id },
        data: updateData,
        include: withCampaign,
      });
    }

    // A map token stores its own COPY of the character's image, taken when it
    // was placed — there is no Token table, tokens live as JSON on the map. So
    // changing the sheet's token image left every placed token showing the old
    // picture until the DM removed and re-added it.
    //
    // This has to happen here rather than from the client: `imageUrl` is a
    // DM-only field on PUT /maps/:id/tokens/:tokenId, so a player editing their
    // own character would be refused.
    //
    // Only the image is synced. A token's NAME is deliberately left alone: the
    // DM may have renamed it ("Aldra (charmed)", or A/B for duplicates) and
    // silently overwriting that on the player's next save would be its own bug.
    let tokensChanged = false;
    const campaignsWithChangedTokens = new Set<string>();
    if (
      updateData.tokenImageUrl !== undefined &&
      updateData.tokenImageUrl !== character.tokenImageUrl
    ) {
      try {
        // Maps are found by the binding itself — a token carrying this
        // `characterId` — rather than by the character's own `campaignId`.
        //
        // Scoping by campaignId silently missed most of the cases it needed to
        // cover, because a character reaches a mismatched state easily:
        // unassigning it nulls `campaignId` and leaves its tokens where they
        // were, a character with tokens in two campaigns can only point at one
        // of them, and a DM placing a player's character writes the token's
        // `characterId` without touching the character. In every one of those
        // the player saw their new picture on the sheet while the token kept the
        // old one, and only removing and re-adding the token helped.
        //
        // `@>` is jsonb containment, so this is one indexable query rather than
        // reading every map in the campaign.
        const boundMaps = await prisma.$queryRaw<
          Array<{ id: string; campaignId: string; tokens: Prisma.JsonValue }>
        >`
          SELECT id, "campaignId", tokens
          FROM "Map"
          WHERE tokens @> ${JSON.stringify([{ characterId: updatedCharacter.id }])}::jsonb
        `;

        // Whose tokens this edit may repaint. The owner's: every campaign
        // bound to the character, except one where the owner is only a
        // spectator, since spectators change nothing at the table and this is
        // the one write of theirs that would otherwise reach it. A DM editing
        // a player's character: only the campaigns that DM runs. The tokens a
        // character left in another campaign are that campaign's, and its DM
        // did not choose the picture.
        const editorRoles = new Map(
          (await prisma.campaignMembership.findMany({
            where: { userId, campaignId: { in: boundMaps.map((m) => m.campaignId) } },
            select: { campaignId: true, role: true },
          })).map((m) => [m.campaignId, m.role])
        );
        const isOwner = character.userId === userId;
        const mayRepaint = (campaignId: string) =>
          isOwner ? editorRoles.get(campaignId) !== 'SPECTATOR' : editorRoles.get(campaignId) === 'DM';

        for (const map of boundMaps) {
          if (!mayRepaint(map.campaignId)) continue;
          // Rewritten from the list as it is under the map's lock, like every
          // other write to a map's tokens; the list the query above returned
          // only says which maps to visit.
          const mapChanged = await withMapsLocked([map.id], async (tx) => {
            const fresh = await tx.map.findUniqueOrThrow({ where: { id: map.id }, select: { tokens: true } });
            let changed = false;
            const nextTokens = readTokens(fresh.tokens).map((token) => {
              if (token?.characterId !== updatedCharacter.id) return token;
              changed = true;
              return { ...token, imageUrl: updateData.tokenImageUrl ?? '' };
            });
            if (changed) await tx.map.update({ where: { id: map.id }, data: { tokens: toJson(nextTokens) } });
            return changed;
          });

          if (mapChanged) {
            tokensChanged = true;
            campaignsWithChangedTokens.add(map.campaignId);
          }
        }
      } catch (error) {
        // The character update itself already succeeded and is what the user
        // asked for; a failure to repaint tokens must not fail the request.
        logger.error('Failed to sync token images after character update', { err: error });
      }
    }

    // A combatant bound to this character shows the token's picture, which
    // the sync above may just have changed.
    for (const affectedCampaignId of campaignsWithChangedTokens) {
      await resendInitiative(affectedCampaignId);
    }

    // Broadcast character update to campaign if character is in a campaign,
    // and its owner is still a member there: a character a removal left
    // naming the campaign is not that table's to read.
    const sheetCampaignId =
      updatedCharacter.campaignId && (await ownerStillIn(updatedCharacter.userId, updatedCharacter.campaignId))
        ? updatedCharacter.campaignId
        : null;
    if (sheetCampaignId) {
      try {
        await emitCharacterUpdated(sheetCampaignId, updatedCharacter, {
          characterId: updatedCharacter.id,
          userId,
          // Lets the map refetch only when a token actually changed, rather
          // than on every sheet save — HP edits broadcast through here too.
          tokensChanged,
        });

        // Hit points additionally go out as `character.hp.updated`, the narrow
        // event the campaign screen's HP cache is built on — it feeds both the
        // roster cards and the HP bars drawn on map tokens.
        //
        // Until this was added, only the roster's own +/- control emitted it,
        // from a WebSocket handler. Editing HP on the sheet took this route
        // instead, so the new value reached the database and the broadcast above
        // but never the cache, and the campaign screen went on showing the old
        // number until the page was refreshed and the roster refetched.
        //
        // Sent only when the value really moved: every roster card and token bar
        // re-renders on this, and most sheet saves do not touch hit points.
        const previousProjected = projectCharacterData(updatedCharacter.gameSystem, character.data);
        const currentProjected = projectCharacterData(
          updatedCharacter.gameSystem,
          updatedCharacter.data
        );
        const previousHp = extractCharacterHp(
          updatedCharacter.gameSystem,
          sheetRecord(previousProjected)
        );
        const currentHp = extractCharacterHp(
          updatedCharacter.gameSystem,
          sheetRecord(currentProjected)
        );
        if (currentHp && !sameCharacterHp(previousHp, currentHp)) {
          broadcastToCampaign(sheetCampaignId, 'character.hp.updated', {
            characterId: updatedCharacter.id,
            hp: currentHp,
          });
        }
      } catch (error) {
        logger.error('Failed to broadcast character update', { err: error });
        // Don't fail the request if broadcast fails
      }
    }

    // A campaign whose map holds a token for this character still needs to
    // repaint it, even when the character does not belong to that campaign —
    // which is the ordinary case once `campaignId` is null, and the reason the
    // token used to sit on the old picture until it was removed and re-added.
    //
    // The sheet itself is deliberately NOT sent here. Membership of the
    // character's campaign is what entitles someone to read it, and these
    // campaigns are by definition not that one; they get the id and the fact
    // that a token moved on, which is all a repaint needs.
    try {
      for (const affectedCampaignId of campaignsWithChangedTokens) {
        if (affectedCampaignId === sheetCampaignId) continue;
        broadcastToCampaign(affectedCampaignId, 'character.updated', {
          characterId: updatedCharacter.id,
          tokensChanged: true,
        });
      }
    } catch (error) {
      logger.error('Failed to broadcast token repaint', { err: error });
    }

    return res.status(200).json({
      message: 'Character updated successfully',
      character: characterForReader(updatedCharacter, keeper),
    });
  } catch (error) {
    logger.error('Error updating character', { err: error });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update character',
    });
  }
});

/**
 * DELETE /api/characters/:id
 * Delete a character
 * Requires: Authentication
 * Authorization: Character owner only
 */
router.delete('/:id', authenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { id } = req.params;

    const character = await prisma.character.findUnique({
      where: { id },
    });

    if (!character) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Character not found',
      });
    }

    // Only owner can delete
    if (character.userId !== userId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the character owner can delete this character',
      });
    }

    await prisma.character.delete({
      where: { id },
    });

    return res.status(200).json({
      message: 'Character deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting character', { err: error });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete character',
    });
  }
});

/**
 * POST /api/characters/:id/assign
 * Assign a character to a campaign (or unassign if campaignId is null/empty)
 * Requires: Authentication
 * Authorization: Character owner only
 * Validation: User must be a member of the target campaign (if assigning)
 */
router.post('/:id/assign', authenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { id } = req.params;
    const { campaignId } = req.body;

    // A campaign id, or null, "" or nothing to unassign.
    if (campaignId !== undefined && campaignId !== null && typeof campaignId !== 'string') {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'campaignId must be a campaign id, or null to unassign',
      });
    }

    const character = await prisma.character.findUnique({
      where: { id },
    });

    if (!character) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Character not found',
      });
    }

    // Only owner can assign/unassign character
    if (character.userId !== userId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the character owner can assign this character to a campaign',
      });
    }

    // Handle unassignment (campaignId is null, empty string, or undefined)
    const targetCampaignId = campaignId && campaignId !== '' ? campaignId : null;

    if (targetCampaignId) {
      // Handle assignment - validate campaign exists and user is a member
      const campaign = await prisma.campaign.findUnique({
        where: { id: targetCampaignId },
        select: {
          id: true,
          name: true,
          gameSystem: true,
        },
      });

      if (!campaign) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Campaign not found',
        });
      }

      // Check if user is a member of the campaign
      const membership = await prisma.campaignMembership.findUnique({
        where: {
          userId_campaignId: {
            userId,
            campaignId: targetCampaignId,
          },
        },
      });

      if (!membership) {
        return res.status(403).json({
          error: 'Forbidden',
          message: ASSIGN_NOT_A_MEMBER,
        });
      }

      // A Campaign with no game system accepts any Character. A typed Campaign
      // refuses a Flexible sheet and any other system. Re-assigning to a
      // mismatched Campaign, including the one the Character is already in, is
      // a mismatched write. Fast-fail here; the write transaction locks the
      // Campaign and checks again against the committed gameSystem.
      try {
        assertCompatible(character.gameSystem, campaign.gameSystem);
      } catch (error) {
        if (error instanceof GameSystemMismatchError) {
          return res.status(400).json({ error: error.error, message: error.message });
        }
        throw error;
      }
    }

    // Previous-membership removal, new-membership characterIds, Keeper's
    // Notes, and Character.campaignId are one transaction for assign and
    // unassign. Compatibility is checked after locking the target Campaign:
    // a 400 must undo every write, and membership characterIds is re-read
    // under FOR UPDATE so a concurrent create-in or assign does not clobber
    // the array. Memberships are locked in sorted campaignId order before
    // Character so this write never waits on a membership after taking that
    // lock (kick is membership then Character; the reverse deadlocks). If
    // locked Character.campaignId is not the hint used to choose those seats,
    // the attempt retries with a fresh hint.
    const { character: updatedCharacter, previousCampaignId, targetRole } =
      await writeCharacterCampaignAssignment({
        characterId: id,
        userId,
        characterGameSystem: character.gameSystem,
        hintedPreviousCampaignId: character.campaignId,
        targetCampaignId,
      });

    if (!targetCampaignId) {
      // Broadcast roster.updated WebSocket event
      if (previousCampaignId) {
        try {
          broadcastToCampaign(previousCampaignId, 'roster.updated', {
            action: 'character.unassigned',
            characterId: id,
            userId,
            campaignId: previousCampaignId,
          });
        } catch (error) {
          logger.error('Failed to broadcast roster update', { err: error });
          // Don't fail the request if broadcast fails
        }
      }

      return res.status(200).json({
        message: 'Character unassigned from campaign successfully',
        character: characterForReader(updatedCharacter, false),
      });
    }

    // Broadcast roster.updated WebSocket event
    try {
      broadcastToCampaign(targetCampaignId, 'roster.updated', {
        action: 'character.assigned',
        characterId: id,
        userId,
        campaignId: targetCampaignId,
      });
    } catch (error) {
      logger.error('Failed to broadcast roster update', { err: error });
      // Don't fail the request if broadcast fails
    }

    return res.status(200).json({
      message: 'Character assigned to campaign successfully',
      character: characterForReader(updatedCharacter, targetRole === 'DM'),
    });
  } catch (error) {
    if (error instanceof GameSystemMismatchError) {
      return res.status(400).json({ error: error.error, message: error.message });
    }
    if (error instanceof CampaignGoneError) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Campaign not found',
      });
    }
    if (error instanceof CharacterGoneError) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Character not found',
      });
    }
    if (error instanceof MembershipGoneError) {
      return res.status(403).json({
        error: 'Forbidden',
        message: error.message,
      });
    }
    logger.error('Error assigning character to campaign', { err: error });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to assign character to campaign',
    });
  }
});

/**
 * POST /api/characters/:id/copy
 * Create a copy of an existing character
 * Requires: Authentication
 * Authorization: Character owner only
 */
router.post('/:id/copy', authenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { id } = req.params;

    // Fetch the original character
    const originalCharacter = await prisma.character.findUnique({
      where: { id },
    });

    if (!originalCharacter) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Character not found',
      });
    }

    // Check ownership
    if (originalCharacter.userId !== userId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to copy this character',
      });
    }

    // Copying a frozen Character is creation (ADR 0013).
    if (isGameSystemSheetFrozen(originalCharacter.gameSystem)) {
      return res.status(400).json(gameSystemSheetFrozenError());
    }

    // Create a copy with modified name. Not the Keeper's Notes: they are the
    // Keeper's, and the copy is in no campaign. Identity stamps the copy's
    // name into the sheet so a later save does not rename it back to the original.
    const copiedName = copyName(originalCharacter.name);
    const owner = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    const prepared = prepareSheetForStorage({
      gameSystem: originalCharacter.gameSystem as GameSystem | null,
      data: originalCharacter.data,
      identity: { name: copiedName, playerDisplayName: owner?.displayName ?? '' },
    });
    if (!prepared.ok) {
      return res.status(400).json({
        error: 'Validation Error',
        message: prepared.message,
        validationErrors: prepared.validationErrors,
      });
    }

    const copiedCharacter = await prisma.$transaction(async (tx) => {
      await roomForCharacter(tx, userId);
      return tx.character.create({
        data: {
          userId,
          name: copiedName,
          data: toJson(sheetWithoutKeeperNotes(originalCharacter.gameSystem, prepared.data)),
          tokenImageUrl: originalCharacter.tokenImageUrl,
          gameSystem: originalCharacter.gameSystem,
          campaignId: null, // Copies are unassigned by default
        },
      });
    });

    return res.status(201).json({
      message: 'Character copied successfully',
      character: characterForReader(copiedCharacter, false),
    });
  } catch (error) {
    if (error instanceof CharacterLimitReached) {
      return res.status(400).json({ error: 'Validation Error', message: CHARACTER_LIMIT_REACHED });
    }
    logger.error('Error copying character', { err: error });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to copy character',
    });
  }
});

export default router;
