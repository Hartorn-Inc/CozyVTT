/**
 * The write-side parse seam for a character sheet: migrate, stamp identity,
 * validate. Projection is read-side (`projectCharacterData`) and does not run
 * here. `sheetRecord` is the backend-only narrowing helper for a projected
 * blob. Keeper's Notes policy belongs to the routes that call this helper.
 */

import { GameSystem } from '../game-systems';
import { migrateLegacySheetFields } from './sheetFieldMigrations';
import {
  applyIdentityToSheet,
  sheetIssues,
  validateCharacterData,
  validateFlexibleSheet,
  type SheetIssue,
} from '../validators/game-systems';

export type { SheetIssue };

export const FLEXIBLE_SHEET_REFUSED = 'Character data does not match the Flexible sheet layout';
export const TYPED_SHEET_REFUSED = 'Character data does not match game system schema';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A projected sheet blob as an indexable record, or null. */
export function sheetRecord(data: unknown): Record<string, unknown> | null {
  return isPlainObject(data) ? data : null;
}

function isTypedGameSystem(gameSystem: GameSystem | null | undefined): gameSystem is GameSystem {
  return (
    gameSystem === GameSystem.DND_5E ||
    gameSystem === GameSystem.PATHFINDER_2E ||
    gameSystem === GameSystem.SHADOWRUN_6E ||
    gameSystem === GameSystem.CALL_OF_CTHULHU_7E
  );
}

export function prepareSheetForStorage(options: {
  gameSystem: GameSystem | null | undefined;
  data: unknown;
  identity?: { name: string; playerDisplayName: string };
}): { ok: true; data: unknown } | { ok: false; message: string; validationErrors: SheetIssue[] } {
  const { gameSystem, data, identity } = options;
  const migrated = migrateLegacySheetFields(gameSystem, data);

  let working: unknown = migrated;
  if (identity && (isPlainObject(working) || working === undefined || working === null)) {
    working = applyIdentityToSheet(
      gameSystem,
      working ?? undefined,
      identity.name,
      identity.playerDisplayName
    );
  }

  if (isTypedGameSystem(gameSystem)) {
    const result = validateCharacterData(gameSystem, working);
    if (!result.success) {
      return {
        ok: false,
        message: TYPED_SHEET_REFUSED,
        validationErrors: sheetIssues(result.errors),
      };
    }
    return { ok: true, data: result.data };
  }

  // Flexible: check the sheet as sent. Identity wrapping would turn a string
  // or a list into an object before it could be refused.
  const flexible = validateFlexibleSheet(data);
  if (!flexible.success) {
    return {
      ok: false,
      message: FLEXIBLE_SHEET_REFUSED,
      validationErrors: sheetIssues(flexible.errors),
    };
  }
  return { ok: true, data: flexible.data };
}
