/**
 * Login-session ids that must not be written back after they were ended.
 *
 * connect-pg-simple `set` is INSERT ON CONFLICT. A request that already
 * loaded a session, then mutates `req.session`, will UPSERT that sid after
 * destroyUserLoginSessions deleted the row, and the next HTTP action would
 * be 200. This process keeps the deleted sids so wrapPgSessionStore can
 * no-op those writes. One backend process (ADR 0007); a restart forgets
 * the map, and the rows stay gone. Prisma-free so config/session.ts can
 * import it without opening a client.
 */

import { rememberMeMaxAge } from '../config/sessionDurations';

/** sid → when the block may be forgotten (now + remember-me window). */
const blocked = new Map<string, number>();

function prune(now: number): void {
  for (const [sid, expiresAt] of blocked) {
    if (expiresAt <= now) blocked.delete(sid);
  }
}

/** Remember deleted login-session ids so a later store `set` cannot revive them. */
export function blockLoginSessions(sids: readonly string[]): void {
  const now = Date.now();
  prune(now);
  if (sids.length === 0) return;
  const expiresAt = now + rememberMeMaxAge;
  for (const sid of sids) blocked.set(sid, expiresAt);
}

/** Whether wrapPgSessionStore must no-op a write for this sid. */
export function isLoginSessionBlocked(sid: string): boolean {
  const expiresAt = blocked.get(sid);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    blocked.delete(sid);
    return false;
  }
  return true;
}

/**
 * Drop a block so a later store `set` may write again. Used when destroy
 * RETURNING succeeded but the helper then failed, so the transaction will
 * not keep the DELETE.
 */
export function unblockLoginSessions(sids: readonly string[]): void {
  for (const sid of sids) blocked.delete(sid);
}
