// ============================================
// Ordered fog:operation queue
//
// Reveal/hide cell lists are chunked. Emits stay inside the server's
// 10/1000ms silent limiter: a minimum gap between messages plus a sliding
// window (10 per 1000ms with a safety margin) so jitter or a second tab
// cannot drop a hide tail. A later rectangle is appended; it does not
// cancel earlier chunks. reveal_all / hide_all wait for window room, then
// go out as the only emit in that slot; leftover unsent cell ops from
// *before* the all-op are dropped then, not before. Cell ops queued
// *after* enqueueAll (a later stroke during the wait) are kept and sent
// after the all-op, and overlay applies them on top of it. Emits always
// go through getSocket() at fire time so a reconnect does not send on a
// dead socket. A null socket leaves the head queued and does not stamp
// an emit. Pure aside from the timer.
// ============================================

import {
  FOG_OPERATION_CHUNK_GAP_MS,
  FOG_OPERATION_WINDOW_LIMIT,
  FOG_OPERATION_WINDOW_MARGIN_MS,
  FOG_OPERATION_WINDOW_MS,
} from './chunkFogCells';

export interface FogCellOperation {
  mapId: string;
  op: 'reveal' | 'hide';
  cells: number[];
}

export interface FogAllOperation {
  mapId: string;
  op: 'reveal_all' | 'hide_all';
}

export type FogQueuedOperation = FogCellOperation | FogAllOperation;

export type FogWireOperation =
  | { op: 'reveal' | 'hide'; cells: number[] }
  | { op: 'reveal_all' | 'hide_all' };

export interface FogOperationSocket {
  emit(
    event: 'fog:operation',
    data: { mapId: string; operation: FogWireOperation }
  ): unknown;
}

export interface FogOperationQueue {
  enqueue(ops: readonly FogCellOperation[]): void;
  /**
   * Queue a full-grid op. Leftover unsent cells from before this call are
   * dropped when it emits; strokes queued after this call are kept.
   */
  enqueueAll(mapId: string, op: FogAllOperation['op']): void;
  /** Drop pending cell ops, a pending all-op, in-flight ops, and any armed timer. Does not emit. */
  clear(): void;
  pending(): FogCellOperation[];
  /** In-flight ops, then a pending all-op, then strokes queued after it (leftovers omitted). */
  overlayOps(): FogQueuedOperation[];
  /**
   * After overlaying a `fog:updated` echo: drop in-flight only when nothing
   * remains unsent and the snapshot already matched the overlay (server caught up).
   */
  ackEcho(snapshotMatchedOverlay: boolean): void;
}

export function createFogOperationQueue(options: {
  getSocket: () => FogOperationSocket | null | undefined;
  gapMs?: number;
  windowLimit?: number;
  windowMs?: number;
  windowMarginMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, delayMs: number) => () => void;
}): FogOperationQueue {
  const gapMs = options.gapMs ?? FOG_OPERATION_CHUNK_GAP_MS;
  const windowLimit = options.windowLimit ?? FOG_OPERATION_WINDOW_LIMIT;
  const windowMs = options.windowMs ?? FOG_OPERATION_WINDOW_MS;
  const windowMarginMs = options.windowMarginMs ?? FOG_OPERATION_WINDOW_MARGIN_MS;
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((fn, delayMs) => {
    const id = setTimeout(fn, delayMs);
    return () => { clearTimeout(id); };
  });

  const pendingOps: FogCellOperation[] = [];
  /** Cell ops queued after a waiting all-op; sent after it, not dropped with leftovers. */
  const afterAllOps: FogCellOperation[] = [];
  const inFlight: FogQueuedOperation[] = [];
  let pendingAll: FogAllOperation | null = null;
  let cancelTimer: (() => void) | null = null;
  let lastEmitAt: number | null = null;
  const emitTimes: number[] = [];

  function hasUnsent(): boolean {
    return pendingAll !== null || pendingOps.length > 0 || afterAllOps.length > 0;
  }

  function waitUntilNextAllowed(t: number): number {
    let wait = 0;
    if (lastEmitAt !== null) {
      wait = Math.max(wait, gapMs - (t - lastEmitAt));
    }
    const windowWithMargin = windowMs + windowMarginMs;
    const recent = emitTimes.filter((stamp) => t - stamp < windowWithMargin);
    if (recent.length >= windowLimit) {
      const oldest = recent[recent.length - windowLimit];
      if (oldest !== undefined) {
        wait = Math.max(wait, oldest + windowWithMargin - t);
      }
    }
    return Math.max(0, wait);
  }

  function recordEmit(t: number): void {
    lastEmitAt = t;
    emitTimes.push(t);
    const windowWithMargin = windowMs + windowMarginMs;
    for (let i = emitTimes.length - 1; i >= 0; i--) {
      const stamp = emitTimes[i];
      if (stamp !== undefined && t - stamp >= windowWithMargin) {
        emitTimes.splice(i, 1);
      }
    }
  }

  function dropUnsentCellsFor(mapId: string): void {
    for (let i = pendingOps.length - 1; i >= 0; i--) {
      if (pendingOps[i]?.mapId === mapId) pendingOps.splice(i, 1);
    }
  }

  function wirePayload(op: FogQueuedOperation): FogWireOperation {
    if (op.op === 'reveal' || op.op === 'hide') {
      return { op: op.op, cells: op.cells };
    }
    return { op: op.op };
  }

  /** Send one op if a live socket is ready. False means retry later (null socket or empty). */
  function tryEmit(): boolean {
    const socket = options.getSocket();
    if (!socket) return false;
    if (pendingAll) {
      const allOp = pendingAll;
      pendingAll = null;
      dropUnsentCellsFor(allOp.mapId);
      if (afterAllOps.length > 0) {
        pendingOps.push(...afterAllOps);
        afterAllOps.length = 0;
      }
      inFlight.push(allOp);
      socket.emit('fog:operation', { mapId: allOp.mapId, operation: wirePayload(allOp) });
      recordEmit(now());
      return true;
    }
    const next = pendingOps[0];
    if (!next) return false;
    pendingOps.shift();
    inFlight.push(next);
    socket.emit('fog:operation', { mapId: next.mapId, operation: wirePayload(next) });
    recordEmit(now());
    return true;
  }

  function arm(): void {
    if (cancelTimer || !hasUnsent()) return;
    const wait = waitUntilNextAllowed(now());
    if (wait === 0) {
      if (!tryEmit()) {
        // Null socket: leave the head queued, do not stamp an emit, retry.
        if (hasUnsent() && !options.getSocket()) {
          cancelTimer = schedule(() => {
            cancelTimer = null;
            arm();
          }, Math.max(gapMs, 1));
        }
        return;
      }
      arm();
      return;
    }
    cancelTimer = schedule(() => {
      cancelTimer = null;
      arm();
    }, wait);
  }

  function rearm(): void {
    cancelTimer?.();
    cancelTimer = null;
    arm();
  }

  return {
    enqueue(ops) {
      if (ops.length === 0) return;
      if (pendingAll) afterAllOps.push(...ops);
      else pendingOps.push(...ops);
      // tryEmit prefers a pending all-op, so leftover cell chunks stay unsent until it goes out.
      arm();
    },
    enqueueAll(mapId, op) {
      // A newer all-op supersedes a waiting one and any stroke queued after it.
      if (pendingAll) {
        pendingOps.push(...afterAllOps);
        afterAllOps.length = 0;
      }
      pendingAll = { mapId, op };
      rearm();
    },
    clear() {
      pendingOps.length = 0;
      afterAllOps.length = 0;
      inFlight.length = 0;
      pendingAll = null;
      cancelTimer?.();
      cancelTimer = null;
    },
    pending() {
      return [...pendingOps, ...afterAllOps];
    },
    overlayOps() {
      const ops: FogQueuedOperation[] = [...inFlight];
      if (pendingAll) {
        ops.push(pendingAll);
        ops.push(...afterAllOps);
      } else {
        ops.push(...pendingOps);
      }
      return ops;
    },
    ackEcho(snapshotMatchedOverlay) {
      if (snapshotMatchedOverlay && !hasUnsent()) inFlight.length = 0;
    },
  };
}
