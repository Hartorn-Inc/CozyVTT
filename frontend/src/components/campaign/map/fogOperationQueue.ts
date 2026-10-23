// ============================================
// Ordered fog:operation queue
//
// Reveal/hide cell lists are chunked and must be spaced ≥100ms so the
// server's 10/s limiter does not drop them. A later rectangle is appended;
// it does not cancel earlier chunks. reveal_all / hide_all flush this
// queue first. Emits always go through getSocket() at fire time so a
// reconnect does not send on a dead socket. Pure aside from the timer.
// ============================================

export interface FogCellOperation {
  mapId: string;
  op: 'reveal' | 'hide';
  cells: number[];
}

export interface FogOperationSocket {
  emit(
    event: 'fog:operation',
    data: { mapId: string; operation: { op: 'reveal' | 'hide'; cells: number[] } }
  ): unknown;
}

export interface FogOperationQueue {
  enqueue(ops: readonly FogCellOperation[]): void;
  /** Drop pending cell ops and any armed timer. Does not emit. */
  clear(): void;
  /** Record that a fog op was sent now (reveal_all / hide_all) so the next cell op waits. */
  noteEmit(): void;
  pending(): FogCellOperation[];
}

export function createFogOperationQueue(options: {
  getSocket: () => FogOperationSocket | null | undefined;
  gapMs: number;
  now?: () => number;
  schedule?: (fn: () => void, delayMs: number) => () => void;
}): FogOperationQueue {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((fn, delayMs) => {
    const id = setTimeout(fn, delayMs);
    return () => { clearTimeout(id); };
  });

  const pendingOps: FogCellOperation[] = [];
  let cancelTimer: (() => void) | null = null;
  let lastEmitAt: number | null = null;

  function emitHead(): void {
    const next = pendingOps.shift();
    if (!next) return;
    options.getSocket()?.emit('fog:operation', {
      mapId: next.mapId,
      operation: { op: next.op, cells: next.cells },
    });
    lastEmitAt = now();
  }

  function arm(): void {
    if (cancelTimer || pendingOps.length === 0) return;
    const wait = lastEmitAt === null ? 0 : Math.max(0, options.gapMs - (now() - lastEmitAt));
    if (wait === 0) {
      emitHead();
      arm();
      return;
    }
    cancelTimer = schedule(() => {
      cancelTimer = null;
      emitHead();
      arm();
    }, wait);
  }

  return {
    enqueue(ops) {
      if (ops.length === 0) return;
      pendingOps.push(...ops);
      arm();
    },
    clear() {
      pendingOps.length = 0;
      cancelTimer?.();
      cancelTimer = null;
    },
    noteEmit() {
      lastEmitAt = now();
    },
    pending() {
      return [...pendingOps];
    },
  };
}
