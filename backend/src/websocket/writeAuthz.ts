/**
 * Commit-time authorization for socket writes (ADR 0007).
 *
 * Discrete HTTP and socket actions use current authorization (0 s stale).
 * Handshake and `authenticate` still cache `socket.role` from membership;
 * handlers never take campaign or role off the wire. A write re-reads the
 * login session and CampaignMembership immediately before it lands, after
 * awaits that could race a kick or demotion, and uses that role for the
 * permission decision.
 *
 * High-frequency `token.move` frames may reuse a successful confirmation for
 * at most `DRAG_AUTH_STALE_MS`. A per-socket monitor then reconfirms at that
 * bound and disconnects when authorization is gone, so a demoted member
 * cannot drag forever on the cached role.
 *
 * A map lock or Character `FOR UPDATE` must not call global `prisma` (MFA
 * policy can INSERT systemLog) or drop sockets while it holds the only
 * connection. Pass `{ db: tx }` only for the membership re-read inside the
 * transaction; confirm session+MFA without `db` first, and apply
 * `dropCampaign` after the transaction returns.
 */

import type { Prisma } from '@prisma/client';
import type { SessionData, Store } from 'express-session';
import { prisma } from '../config/database';
import { sessionHasAgedOut, sessionIsSignedIn } from '../services/signedIn';
import { adminMfaDeadline } from '../services/adminMfaPolicy';
import logger from '../utils/logger';
import type { AuthenticatedSocket } from './auth';
import { clearCampaignFromLiveSockets } from './utils';

/**
 * How long a successful session+membership confirm may be reused for
 * `token.move` frames. Discrete writes, `token.move.start` and
 * `token.move.end` are 0 s stale. Exported so tests can wait this bound.
 */
export const DRAG_AUTH_STALE_MS = 2000;

/**
 * Same sentence HTTP uses for LoginSessionStoreUnavailable (503). A store or
 * policy that cannot be confirmed fails closed: the write does not land, and
 * it is not treated as signed-out.
 */
export const LOGIN_SESSION_UNCONFIRMED_MESSAGE =
  'The login session could not be confirmed. Try again in a moment.';

/** `campaign.access.revoked` message when a drag/monitor finds the login session dead. */
const SESSION_ENDED_MESSAGE = 'Your sign-in has ended. Sign in again.';

type MembershipDb = Pick<Prisma.TransactionClient, 'campaignMembership'>;

export type WriteAuthzResult =
  | { ok: true; role: string }
  | { ok: false; dropCampaign?: true; campaignId?: string };

export type WriteAuthzOptions = {
  /**
   * The campaign this write was captured for (`socket.campaignId` at handler
   * start, before any await). `authenticate` is not serialized with handlers
   * and can move the socket to another campaign while this write is in
   * `confirmWriteAuthorization` or `withMapsLocked`. Membership lookup and
   * `dropCampaign` use this id. If the socket is already in another campaign,
   * the write is refused without dropping that other campaign, without
   * assigning `socket.role`, and without emitting into the new room.
   */
  campaignId?: string;
  /**
   * Membership re-read through a held transaction (map lock / Character
   * `FOR UPDATE`). Skips the session store, MFA (global prisma), and socket
   * disconnect. Missing membership is `dropCampaign` for the caller to apply
   * after the transaction.
   */
  db?: MembershipDb;
  /**
   * Discrete writes keep going with the fresh role. Drag frames and the 2 s
   * monitor disconnect so a demotion cannot ride the cached `socket.role`.
   */
  onRoleChange?: 'use-fresh' | 'disconnect';
  /**
   * An unconfirmable store or MFA policy: discrete writes tell the sender,
   * drag frames and the monitor stay quiet (the write/frame still does not
   * land).
   */
  announceUnconfirmed?: boolean;
};

function sessionStoreOf(socket: AuthenticatedSocket): Store | undefined {
  return (socket.request as { sessionStore?: Store }).sessionStore;
}

/**
 * The login session this socket was opened under, or why it cannot be used.
 * A store callback error is distinct from a missing row: the former is 503
 * fail-closed, the latter is a dead sign-in.
 */
async function readLoginSession(
  socket: AuthenticatedSocket
): Promise<{ kind: 'unconfirmed' } | { kind: 'missing' } | { kind: 'ok'; session: Partial<SessionData> }> {
  const sessionStore = sessionStoreOf(socket);
  const sessionId = socket.sessionId;
  const userId = socket.userId;
  if (!sessionId || !userId) return { kind: 'missing' };
  // No store is an outage, not a dead sign-in: fail closed without
  // treating the connection as signed-out.
  if (!sessionStore) return { kind: 'unconfirmed' };

  let result: { err: Error | null; found: Partial<SessionData> | null };
  try {
    result = await new Promise((resolve) => {
      sessionStore.get(sessionId, (err, found) => {
        if (err) {
          const error = err instanceof Error ? err : new Error('Login session store failed');
          resolve({ err: error, found: null });
          return;
        }
        resolve({ err: null, found: found ?? null });
      });
    });
  } catch (error) {
    logger.error('Login session store could not be confirmed', { err: error });
    return { kind: 'unconfirmed' };
  }

  if (result.err) {
    logger.error('Login session store could not be confirmed', { err: result.err });
    return { kind: 'unconfirmed' };
  }
  if (!result.found) return { kind: 'missing' };
  return { kind: 'ok', session: result.found };
}

function emitUnconfirmed(socket: AuthenticatedSocket, announce: boolean): void {
  if (announce) socket.emit('error', { message: LOGIN_SESSION_UNCONFIRMED_MESSAGE });
}

function refuseDeadSession(socket: AuthenticatedSocket, asSignedOut: boolean): void {
  if (asSignedOut) {
    socket.emit('campaign.access.revoked', {
      campaignId: socket.campaignId ?? null,
      reason: 'signed-out',
      message: SESSION_ENDED_MESSAGE,
    });
  } else {
    socket.emit('error', { message: 'Unauthorized' });
  }
  socket.disconnect(true);
}

function dropThisSocketForRoleChange(socket: AuthenticatedSocket): void {
  // Still a member: no `campaign.access.revoked`, so the production client
  // reconnects and `authenticate` picks up the new role. Login session remains.
  socket.disconnect(true);
}

export function markWriteAuthzConfirmed(socket: AuthenticatedSocket): void {
  socket.writeAuthzConfirmedAt = Date.now();
}

function writeAuthzCacheIsFresh(socket: AuthenticatedSocket, now = Date.now()): boolean {
  const at = socket.writeAuthzConfirmedAt;
  return typeof at === 'number' && now - at < DRAG_AUTH_STALE_MS;
}

/**
 * Kick those campaign sockets after a membership-only confirm that ran
 * inside a transaction. No-op unless `dropCampaign` is set. Drops the
 * campaign the write was captured for (`result.campaignId`), not whatever
 * the socket holds now after a concurrent `authenticate`.
 */
export async function applyWriteAuthzDrop(
  socket: AuthenticatedSocket,
  result: { dropCampaign?: true; campaignId?: string } | { ok: false }
): Promise<void> {
  if (!('dropCampaign' in result) || result.dropCampaign !== true) return;
  const userId = socket.userId;
  const campaignId = result.campaignId ?? socket.campaignId;
  if (!userId || !campaignId) return;
  await clearCampaignFromLiveSockets(userId, campaignId);
}

/** The socket joined another campaign while this write for `writeCampaignId` was in flight. */
function liveCampaignDiffers(socket: AuthenticatedSocket, writeCampaignId: string): boolean {
  return typeof socket.campaignId === 'string' && socket.campaignId !== writeCampaignId;
}

async function confirmMembershipThrough(
  socket: AuthenticatedSocket,
  db: MembershipDb,
  announceUnconfirmed: boolean,
  onRoleChange: 'use-fresh' | 'disconnect',
  writeCampaignId: string
): Promise<WriteAuthzResult> {
  const userId = socket.userId;
  if (!userId) return { ok: false };

  let membership: { role: string } | null;
  try {
    membership = await db.campaignMembership.findUnique({
      where: { userId_campaignId: { userId, campaignId: writeCampaignId } },
      select: { role: true },
    });
  } catch (error) {
    logger.error('Campaign membership could not be confirmed', { err: error });
    emitUnconfirmed(socket, announceUnconfirmed);
    return { ok: false };
  }

  if (!membership) return { ok: false, dropCampaign: true, campaignId: writeCampaignId };

  // authenticate may have moved the socket during the membership read: do
  // not stamp the captured campaign's role onto the campaign it is in now.
  if (liveCampaignDiffers(socket, writeCampaignId)) return { ok: false };

  const previousRole = socket.role;
  if (onRoleChange === 'disconnect' && previousRole !== undefined && previousRole !== membership.role) {
    // Discrete locked writes use the fresh role. Drag/monitor never pass `db`.
    return { ok: false };
  }

  socket.role = membership.role;
  // Do not stamp writeAuthzConfirmedAt: this path skipped the session store.
  // Stamping would let token.move frames treat a membership-only confirm as a
  // full confirm for DRAG_AUTH_STALE_MS. Pre-lock confirmWriteAuthorization()
  // without `db` still stamps. Discrete writes are 0 s stale and do not use
  // that cache. Drag/monitor never pass `db`.
  return { ok: true, role: membership.role };
}

/**
 * Re-read the login session and CampaignMembership, then either allow the
 * write with the fresh role or refuse it (and, for the kick / session-dead /
 * drag-role-change paths, drop the socket).
 *
 * When `options.db` is a transaction, only CampaignMembership is re-read
 * through it. Session, MFA, and socket drops stay outside the lock.
 */
export async function confirmWriteAuthorization(
  socket: AuthenticatedSocket,
  options: WriteAuthzOptions = {}
): Promise<WriteAuthzResult> {
  const onRoleChange = options.onRoleChange ?? 'use-fresh';
  const announceUnconfirmed = options.announceUnconfirmed ?? true;
  const dragDisconnect = onRoleChange === 'disconnect';

  const userId = socket.userId;
  const writeCampaignId = options.campaignId ?? socket.campaignId;
  if (!userId || !writeCampaignId) return { ok: false };
  if (liveCampaignDiffers(socket, writeCampaignId)) return { ok: false };

  if (options.db) {
    return confirmMembershipThrough(socket, options.db, announceUnconfirmed, onRoleChange, writeCampaignId);
  }

  const stored = await readLoginSession(socket);
  if (stored.kind === 'unconfirmed') {
    emitUnconfirmed(socket, announceUnconfirmed);
    return { ok: false };
  }
  if (
    stored.kind === 'missing' ||
    !sessionIsSignedIn(stored.session) ||
    sessionHasAgedOut(stored.session) ||
    stored.session.userId !== userId
  ) {
    refuseDeadSession(socket, dragDisconnect);
    return { ok: false };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, platformRole: true, mfaEnabled: true, createdAt: true },
    });
    if (!user) {
      refuseDeadSession(socket, dragDisconnect);
      return { ok: false };
    }
    let deadline: Date | null;
    try {
      deadline = await adminMfaDeadline(user);
    } catch (error) {
      logger.error('Error checking the administrator two-factor policy', { err: error });
      emitUnconfirmed(socket, announceUnconfirmed);
      return { ok: false };
    }
    if (deadline !== null && deadline.getTime() <= Date.now()) {
      // Same as handshake: the sign-in is still there, the account may not
      // use the live table until MFA is set up.
      socket.emit('error', { message: 'Unauthorized' });
      socket.disconnect(true);
      return { ok: false };
    }
  } catch (error) {
    logger.error('Error checking the administrator two-factor policy', { err: error });
    emitUnconfirmed(socket, announceUnconfirmed);
    return { ok: false };
  }

  let membership: { role: string } | null;
  try {
    membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId, campaignId: writeCampaignId } },
      select: { role: true },
    });
  } catch (error) {
    logger.error('Campaign membership could not be confirmed', { err: error });
    emitUnconfirmed(socket, announceUnconfirmed);
    return { ok: false };
  }

  if (!membership) {
    await clearCampaignFromLiveSockets(userId, writeCampaignId);
    return { ok: false };
  }

  if (liveCampaignDiffers(socket, writeCampaignId)) return { ok: false };

  const previousRole = socket.role;
  if (dragDisconnect && previousRole !== undefined && previousRole !== membership.role) {
    dropThisSocketForRoleChange(socket);
    return { ok: false };
  }

  socket.role = membership.role;
  markWriteAuthzConfirmed(socket);
  return { ok: true, role: membership.role };
}

/**
 * `token.move` frames: skip the session-store and membership round-trip when
 * the last successful confirm is younger than `DRAG_AUTH_STALE_MS`. Payload
 * and map/token checks still run. On a stale cache, reconfirm; failure
 * disconnects (kick / signed-out / role-change).
 */
export async function confirmDragFrameAuthorization(
  socket: AuthenticatedSocket,
  campaignId?: string
): Promise<boolean> {
  const writeCampaignId = campaignId ?? socket.campaignId;
  if (!writeCampaignId || !socket.userId) return false;
  if (liveCampaignDiffers(socket, writeCampaignId)) return false;
  if (writeAuthzCacheIsFresh(socket)) return true;
  const result = await confirmWriteAuthorization(socket, {
    campaignId: writeCampaignId,
    onRoleChange: 'disconnect',
    announceUnconfirmed: false,
  });
  return result.ok;
}

async function runWriteAuthzMonitor(socket: AuthenticatedSocket): Promise<void> {
  if (!socket.connected || !socket.campaignId || !socket.userId) return;
  await confirmWriteAuthorization(socket, {
    onRoleChange: 'disconnect',
    announceUnconfirmed: false,
  });
}

/** While the socket is in a campaign, reconfirm at the 2 s drag bound. */
export function startWriteAuthzMonitor(socket: AuthenticatedSocket): void {
  if (socket.writeAuthzMonitor) return;
  socket.writeAuthzMonitor = setInterval(() => {
    void runWriteAuthzMonitor(socket);
  }, DRAG_AUTH_STALE_MS);
  socket.writeAuthzMonitor.unref?.();
}

export function stopWriteAuthzMonitor(socket: AuthenticatedSocket): void {
  if (!socket.writeAuthzMonitor) return;
  clearInterval(socket.writeAuthzMonitor);
  socket.writeAuthzMonitor = undefined;
}
