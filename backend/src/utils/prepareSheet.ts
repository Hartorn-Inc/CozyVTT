/**
 * The write-side parse seam for a character sheet: migrate, stamp identity,
 * validate. Projection is read-side (`projectCharacterData`) and does not run
 * here. `sheetRecord` is the backend-only narrowing helper for a projected
 * blob. Keeper's Notes policy belongs to the routes that call this helper.
 * Live HP and hit-die writes use `acceptLiveSheetPatch` on the same Zod
 * boundary, without refusing a sheet that already failed the full schema
 * unless the patch itself is new damage.
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

export type SheetPrepareResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string; validationErrors: SheetIssue[] };

/** TS enum or the Prisma string enum that stores the same values. */
type SheetSystemId = GameSystem | `${GameSystem}` | null | undefined;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A projected sheet blob as an indexable record, or null. */
export function sheetRecord(data: unknown): Record<string, unknown> | null {
  return isPlainObject(data) ? data : null;
}

function isTypedGameSystem(gameSystem: SheetSystemId): gameSystem is GameSystem {
  return (
    gameSystem === GameSystem.DND_5E ||
    gameSystem === GameSystem.PATHFINDER_2E ||
    gameSystem === GameSystem.SHADOWRUN_6E ||
    gameSystem === GameSystem.CALL_OF_CTHULHU_7E
  );
}

/**
 * REST's migrate-then-validate step, without identity stamping. Typed sheets
 * are checked after migration; Flexible is checked as `flexibleSource` so a
 * string or list is refused before identity wrapping could turn it into an
 * object.
 */
function parseSheet(
  gameSystem: SheetSystemId,
  typedWorking: unknown,
  flexibleSource: unknown
): SheetPrepareResult {
  if (isTypedGameSystem(gameSystem)) {
    const result = validateCharacterData(gameSystem, typedWorking);
    if (!result.success) {
      return {
        ok: false,
        message: TYPED_SHEET_REFUSED,
        validationErrors: sheetIssues(result.errors),
      };
    }
    return { ok: true, data: result.data };
  }

  const flexible = validateFlexibleSheet(flexibleSource);
  if (!flexible.success) {
    return {
      ok: false,
      message: FLEXIBLE_SHEET_REFUSED,
      validationErrors: sheetIssues(flexible.errors),
    };
  }
  return { ok: true, data: flexible.data };
}

function issueTriple(issue: SheetIssue): string {
  return `${issue.path}\u0000${issue.code}\u0000${issue.message}`;
}

function issuesOf(result: SheetPrepareResult): SheetIssue[] {
  return result.ok ? [] : result.validationErrors;
}

function refusalMessage(gameSystem: SheetSystemId): string {
  return isTypedGameSystem(gameSystem) ? TYPED_SHEET_REFUSED : FLEXIBLE_SHEET_REFUSED;
}

/**
 * An issue is a patched-field issue only when it names a changed path or a
 * field nested under one. A parent list (`hitDice`) is not a patched field
 * when only a child (`hitDice.0.remaining`) changed; a length change already
 * puts the array path itself in `changedPaths`.
 */
function pathsRelated(issuePath: string, changedPath: string): boolean {
  return issuePath === changedPath || issuePath.startsWith(`${changedPath}.`);
}

function childPath(parent: string, key: string): string {
  return parent === '' ? key : `${parent}.${key}`;
}

/**
 * Dotted paths whose values differ. Equal array lengths are compared by
 * index; a length change is the array path itself, so a new over-limit list
 * still matches issues named on that list.
 */
function collectChangedPaths(left: unknown, right: unknown, path: string): string[] {
  if (Object.is(left, right)) return [];
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return [path];
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    return [path];
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return [path];
    const nested: string[] = [];
    for (let i = 0; i < left.length; i += 1) {
      nested.push(...collectChangedPaths(left[i], right[i], childPath(path, String(i))));
    }
    return nested;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  const nested: string[] = [];
  for (const key of keys) {
    nested.push(...collectChangedPaths(leftRecord[key], rightRecord[key], childPath(path, key)));
  }
  return nested;
}

function uniqueIssues(issues: SheetIssue[]): SheetIssue[] {
  const seen = new Set<string>();
  const unique: SheetIssue[] = [];
  for (const issue of issues) {
    const key = issueTriple(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique;
}

export function prepareSheetForStorage(options: {
  gameSystem: GameSystem | null | undefined;
  data: unknown;
  identity?: { name: string; playerDisplayName: string };
}): SheetPrepareResult {
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

  // Flexible: check the sheet as sent. Identity wrapping would turn a string
  // or a list into an object before it could be refused.
  return parseSheet(gameSystem, working, data);
}

/**
 * Live HP / hit-die writes share REST's Zod storage boundary. A patch is
 * refused only when a patched field is invalid under that schema or the patch
 * introduces a new issue the original sheet did not already have. Extra keys
 * and over-limit lists stay as written when the original already failed; both
 * sides fully parsing returns the same parsed blob REST would store.
 * Projection does not run here; current resources are writes.
 */
export function acceptLiveSheetPatch(options: {
  gameSystem: GameSystem | `${GameSystem}` | null | undefined;
  original: unknown;
  patched: unknown;
}): SheetPrepareResult {
  const { gameSystem, original, patched } = options;
  const migratedOriginal = migrateLegacySheetFields(gameSystem, original);
  const migratedPatched = migrateLegacySheetFields(gameSystem, patched);

  const originalParsed = parseSheet(gameSystem, migratedOriginal, migratedOriginal);
  const patchedParsed = parseSheet(gameSystem, migratedPatched, migratedPatched);

  if (originalParsed.ok && patchedParsed.ok) {
    return patchedParsed;
  }

  const originalIssues = issuesOf(originalParsed);
  const patchedIssues = issuesOf(patchedParsed);
  const originalTriples = new Set(originalIssues.map(issueTriple));
  const newIssues = patchedIssues.filter((issue) => !originalTriples.has(issueTriple(issue)));
  const changedPaths = collectChangedPaths(migratedOriginal, migratedPatched, '');
  const patchedFieldIssues = patchedIssues.filter((issue) =>
    changedPaths.some((changedPath) => pathsRelated(issue.path, changedPath))
  );

  if (newIssues.length > 0 || patchedFieldIssues.length > 0) {
    return {
      ok: false,
      message: refusalMessage(gameSystem),
      validationErrors: uniqueIssues([...newIssues, ...patchedFieldIssues]),
    };
  }

  return { ok: true, data: migratedPatched };
}
