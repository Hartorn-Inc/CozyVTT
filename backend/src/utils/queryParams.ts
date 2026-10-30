/**
 * Validate and extract a scalar query parameter.
 *
 * Express query parsing produces an array when a parameter appears multiple
 * times in a query string (e.g. `?param=a&param=b`). When passed directly to
 * Prisma filters, arrays where scalars are expected cause database rejections.
 *
 * Absent gives `undefined`. A repeated parameter is refused with an error
 * message explaining that it cannot be specified multiple times.
 */
export function readScalarQuery(
  value: unknown,
  paramName: string
): { ok: true; value: string | undefined } | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (Array.isArray(value)) {
    return {
      ok: false,
      message: `Parameter "${paramName}" cannot be specified multiple times.`,
    };
  }
  if (typeof value === 'string') {
    return { ok: true, value };
  }
  return {
    ok: false,
    message: `Parameter "${paramName}" must be a string.`,
  };
}
