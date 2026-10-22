/**
 * Drop rows whose required name (or class) is missing or whitespace-only.
 *
 * Editors keep those rows while someone types; the save payload must not.
 * Do not run this on every render — a nameless row is what "Add" creates.
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

/** `rows` without unnamed entries, or `undefined` when nothing was passed. */
export function omitUnnamedRows<T>(rows: T[] | undefined, requiredKey: string): T[] | undefined {
  if (rows === undefined) return undefined;
  return rows.filter((row) => rowHasRequiredName(row, requiredKey));
}
