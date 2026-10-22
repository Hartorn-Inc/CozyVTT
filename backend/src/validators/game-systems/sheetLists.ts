/**
 * Lists shared by every typed system's sheet schema, each held to its limit in
 * sheetLimits.ts.
 */

import { z } from 'zod';
import { SHEET_LIST_MAX } from './sheetLimits';

/**
 * A list on a sheet: inventory, attacks, spells, features, conditions. The
 * message is what a player whose list is over the limit is told, beside the
 * name of the list.
 */
export function sheetList<T extends z.ZodType>(entry: T, max: number = SHEET_LIST_MAX) {
  return z.array(entry).max(max, `Can hold at most ${max.toLocaleString('en-US')} entries`);
}

/**
 * Whether a row has a usable value in the field the list requires to keep it
 * (a name, a hit-die class). Missing, null, and whitespace-only are unnamed.
 * A non-string value is left for the entry schema to refuse.
 */
function rowHasRequiredName(row: unknown, requiredKey: string): boolean {
  if (typeof row === 'string') return row.trim().length > 0;
  if (typeof row !== 'object' || row === null) return true;
  if (!Object.prototype.hasOwnProperty.call(row, requiredKey)) return false;
  const name = (row as Record<string, unknown>)[requiredKey];
  if (name == null) return false;
  if (typeof name === 'string') return name.trim().length > 0;
  return true;
}

/**
 * Drop rows whose required name (or class) is missing or whitespace-only. A
 * blank row may sit in the editor; it is not stored. Other filled fields on
 * a nameless row are dropped with it. Non-arrays are left for the list schema.
 */
export function omitUnnamedRows(value: unknown, requiredKey: string): unknown {
  if (!Array.isArray(value)) return value;
  return value.filter((row) => rowHasRequiredName(row, requiredKey));
}

/**
 * A named object list: blank required-name rows are omitted, then the rest
 * are held to the same count limit as {@link sheetList}. The omit runs first
 * so a full list plus a nameless row still saves.
 */
export function sheetNamedList<T extends z.ZodType>(
  entry: T,
  requiredKey: string,
  max: number = SHEET_LIST_MAX
) {
  return z.preprocess((value) => omitUnnamedRows(value, requiredKey), sheetList(entry, max));
}
