/**
 * Ordered fog:operation queue. A later rectangle is appended, not a cancel
 * of earlier chunks. Drain always asks getSocket() at fire time. Emits stay
 * inside a 10/1000ms sliding window with margin; reveal_all / hide_all wait
 * for that window rather than racing the limiter. A stroke after enqueueAll
 * is kept and sent after the all-op.
 */

import { describe, it, expect } from 'vitest';
import { createFogOperationQueue, type FogCellOperation, type FogOperationSocket } from '../fogOperationQueue';
import { fogRevealedEquals, overlayFogOperations } from '../overlayFogOperations';

function op(cells: number[], mapId = 'map-1'): FogCellOperation {
  return { mapId, op: 'reveal', cells };
}

function fakeSocket() {
  const emitted: Array<{ mapId: string; operation: { op: string; cells?: number[] } }> = [];
  const stateRequests: Array<{ mapId: string }> = [];
  const socket: FogOperationSocket = {
    emit(event: string, data: unknown) {
      if (event === 'fog:operation') emitted.push(data as { mapId: string; operation: { op: string; cells?: number[] } });
      if (event === 'fog:request_state') stateRequests.push(data as { mapId: string });
    },
  };
  return { socket, emitted, stateRequests };
}

function queueHarness(getSocket: () => FogOperationSocket | null | undefined) {
  let t = 0;
  const scheduled: Array<{ fire: () => void; delay: number; at: number }> = [];
  const q = createFogOperationQueue({
    getSocket,
    gapMs: 100,
    now: () => t,
    schedule: (fn, delayMs) => {
      const item = { fire: fn, delay: delayMs, at: t + delayMs };
      scheduled.push(item);
      return () => {
        const i = scheduled.indexOf(item);
        if (i !== -1) scheduled.splice(i, 1);
      };
    },
  });
  return {
    q,
    scheduled,
    now: () => t,
    advance(ms: number) {
      const end = t + ms;
      while (scheduled.length > 0) {
        scheduled.sort((a, b) => a.at - b.at);
        const next = scheduled[0];
        if (!next || next.at > end) break;
        t = next.at;
        const i = scheduled.indexOf(next);
        if (i !== -1) scheduled.splice(i, 1);
        next.fire();
      }
      t = end;
    },
  };
}

describe('createFogOperationQueue', () => {
  it('appends a second batch without dropping the first', () => {
    const s = fakeSocket();
    const { q, advance } = queueHarness(() => s.socket);
    q.enqueue([op([1]), op([2])]);
    q.enqueue([op([3])]);
    expect(s.emitted.map((e) => e.operation.cells)).toEqual([[1]]);
    expect(q.pending().map((p) => p.cells)).toEqual([[2], [3]]);
    advance(100);
    expect(s.emitted.map((e) => e.operation.cells)).toEqual([[1], [2]]);
    advance(100);
    expect(s.emitted.map((e) => e.operation.cells)).toEqual([[1], [2], [3]]);
    expect(q.pending()).toEqual([]);
  });

  it('clear drops pending cell ops so a map change cannot flush a late hide', () => {
    const s = fakeSocket();
    const { q, scheduled } = queueHarness(() => s.socket);
    q.enqueue([op([1]), op([2])]);
    expect(q.pending()).toHaveLength(1);
    q.clear();
    expect(q.pending()).toEqual([]);
    expect(scheduled).toEqual([]);
    s.socket.emit('fog:operation', { mapId: 'map-1', operation: { op: 'reveal', cells: [] } });
    expect(q.pending()).toEqual([]);
  });

  it('drain uses a getter for the live socket, not a closed-over one', () => {
    const first = fakeSocket();
    const second = fakeSocket();
    let live = first.socket;
    const { q, advance } = queueHarness(() => live);
    q.enqueue([op([1]), op([2])]);
    expect(first.emitted).toHaveLength(1);
    expect(second.emitted).toHaveLength(0);
    live = second.socket;
    advance(100);
    expect(first.emitted).toHaveLength(1);
    expect(second.emitted.map((e) => e.operation.cells)).toEqual([[2]]);
  });

  it('emits immediately when idle and spaces the rest by the gap', () => {
    const s = fakeSocket();
    const { q, scheduled } = queueHarness(() => s.socket);
    q.enqueue([op([8]), op([9])]);
    expect(s.emitted).toHaveLength(1);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delay).toBe(100);
  });

  it('emits up to the headroom limit under the shared ceiling, then waits until window has room', () => {
    const s = fakeSocket();
    const { q, advance } = queueHarness(() => s.socket);
    q.enqueue(Array.from({ length: 6 }, (_, i) => op([i])));
    expect(s.emitted).toHaveLength(1);
    for (let i = 0; i < 4; i++) advance(100);
    expect(s.emitted).toHaveLength(5);
    advance(100);
    expect(s.emitted).toHaveLength(5);
    advance(550);
    expect(s.emitted).toHaveLength(6);
    expect(s.emitted[5]?.operation.cells).toEqual([5]);
  });

  it('null socket between two chunks does not drop the second', () => {
    const s = fakeSocket();
    let live: FogOperationSocket | null = s.socket;
    const { q, advance } = queueHarness(() => live);
    q.enqueue([op([1]), op([2])]);
    expect(s.emitted).toHaveLength(1);
    live = null;
    advance(100);
    expect(s.emitted).toHaveLength(1);
    expect(q.pending().map((p) => p.cells)).toEqual([[2]]);
    live = s.socket;
    advance(100);
    expect(s.emitted.map((e) => e.operation.cells)).toEqual([[1], [2]]);
    expect(q.pending()).toEqual([]);
  });
});

describe('enqueueAll', () => {
  it('does not emit reveal_all at t=0 when the 10/1000ms window is full', () => {
    const s = fakeSocket();
    const { q, advance } = queueHarness(() => s.socket);
    q.enqueue(Array.from({ length: 10 }, (_, i) => op([i])));
    for (let i = 0; i < 9; i++) advance(100);
    expect(s.emitted).toHaveLength(5);

    q.enqueueAll('map-1', 'reveal_all');
    expect(s.emitted).toHaveLength(5);
    expect(s.emitted.some((e) => e.operation.op === 'reveal_all')).toBe(false);

    advance(650);
    expect(s.emitted).toHaveLength(6);
    expect(s.emitted[5]).toEqual({ mapId: 'map-1', operation: { op: 'reveal_all' } });
    expect(q.pending()).toEqual([]);
  });

  it('does not emit hide_all at t=0 when the window is full, then drops leftover cells', () => {
    const s = fakeSocket();
    const { q, advance } = queueHarness(() => s.socket);
    q.enqueue(Array.from({ length: 10 }, (_, i) => op([i])));
    for (let i = 0; i < 4; i++) advance(100);
    q.enqueue([op([99])]);
    q.enqueueAll('map-1', 'hide_all');
    expect(s.emitted).toHaveLength(5);
    expect(q.pending().map((p) => p.cells)).toEqual([[99]]);

    advance(650);
    expect(s.emitted[5]).toEqual({ mapId: 'map-1', operation: { op: 'hide_all' } });
    expect(s.emitted.some((e) => e.operation.cells?.[0] === 99)).toBe(false);
    expect(q.pending()).toEqual([]);
  });

  it('waits after a two-chunk reveal, then emits reveal_all instead of the leftover chunk', () => {
    const s = fakeSocket();
    const { q, advance } = queueHarness(() => s.socket);
    const first = Array.from({ length: 20000 }, (_, i) => i);
    const second = [20000];
    q.enqueue([op(first), op(second)]);
    expect(s.emitted).toHaveLength(1);
    expect(s.emitted[0]?.operation.cells).toHaveLength(20000);

    q.enqueueAll('map-1', 'reveal_all');
    expect(s.emitted).toHaveLength(1);
    expect(q.pending().map((p) => p.cells)).toEqual([second]);

    advance(100);
    expect(s.emitted).toHaveLength(2);
    expect(s.emitted[1]).toEqual({ mapId: 'map-1', operation: { op: 'reveal_all' } });
    expect(s.emitted.some((e) => e.operation.cells?.length === 1 && e.operation.cells[0] === 20000)).toBe(false);
    expect(q.pending()).toEqual([]);
  });

  it('keeps a stroke queued after Hide all and sends it after the all-op', () => {
    const s = fakeSocket();
    const { q, advance } = queueHarness(() => s.socket);
    q.enqueue(Array.from({ length: 10 }, (_, i) => op([i])));
    for (let i = 0; i < 4; i++) advance(100);
    q.enqueue([op([99])]);
    q.enqueueAll('map-1', 'hide_all');
    q.enqueue([op([42], 'map-1')]);
    expect(s.emitted).toHaveLength(5);
    expect(q.overlayOps().map((o) => o.op)).toEqual([
      ...Array.from({ length: 5 }, () => 'reveal'),
      'hide_all',
      'reveal',
    ]);
    const overlay = q.overlayOps();
    expect(overlay[overlay.length - 1]).toEqual(op([42]));

    advance(650);
    expect(s.emitted[5]).toEqual({ mapId: 'map-1', operation: { op: 'hide_all' } });
    expect(s.emitted.some((e) => e.operation.cells?.[0] === 99)).toBe(false);
    expect(q.pending().map((p) => p.cells)).toEqual([[42]]);

    advance(100);
    expect(s.emitted[6]).toEqual({ mapId: 'map-1', operation: { op: 'reveal', cells: [42] } });
    expect(q.pending()).toEqual([]);
  });
});

describe('overlayOps / ackEcho', () => {
  it('keeps in-flight and pending ops until the echo of the last unsent op', () => {
    const s = fakeSocket();
    const { q, advance } = queueHarness(() => s.socket);
    q.enqueue([op([1]), op([2])]);
    expect(q.overlayOps().map((o) => 'cells' in o ? o.cells : [])).toEqual([[1], [2]]);
    q.ackEcho(true);
    expect(q.overlayOps()).toHaveLength(2);
    advance(100);
    expect(q.pending()).toEqual([]);
    q.ackEcho(true);
    expect(q.overlayOps()).toEqual([]);
  });

  it('does not ack reveal_all on a partial chunk echo, then acks once the snapshot matches', () => {
    const s = fakeSocket();
    const { q, advance } = queueHarness(() => s.socket);
    q.enqueue([op([0, 1])]);
    q.enqueueAll('map-1', 'reveal_all');
    advance(100);
    expect(q.pending()).toEqual([]);
    expect(q.overlayOps().map((o) => o.op)).toEqual(['reveal', 'reveal_all']);

    const fog = (revealed: boolean[]) => ({ fogCols: revealed.length, fogRows: 1, cellPx: 32, revealed });

    const partial = fog([true, true, false]);
    const first = overlayFogOperations(partial, q.overlayOps());
    expect(first.revealed).toEqual([true, true, true]);
    expect(fogRevealedEquals(partial, first)).toBe(false);
    q.ackEcho(fogRevealedEquals(partial, first));
    expect(q.overlayOps().map((o) => o.op)).toEqual(['reveal', 'reveal_all']);

    const secondPartial = fog([true, false, false]);
    const second = overlayFogOperations(secondPartial, q.overlayOps());
    expect(second.revealed).toEqual([true, true, true]);
    q.ackEcho(fogRevealedEquals(secondPartial, second));
    expect(q.overlayOps().map((o) => o.op)).toEqual(['reveal', 'reveal_all']);

    const full = fog([true, true, true]);
    const caughtUp = overlayFogOperations(full, q.overlayOps());
    expect(fogRevealedEquals(full, caughtUp)).toBe(true);
    q.ackEcho(fogRevealedEquals(full, caughtUp));
    expect(q.overlayOps()).toEqual([]);

    const foreign = fog([true, true, false]);
    expect(overlayFogOperations(foreign, q.overlayOps()).revealed).toEqual([true, true, false]);
  });

  it('retires in-flight operations when a newer grid arrives', () => {
    const s = fakeSocket();
    const { q } = queueHarness(() => s.socket);
    q.enqueue([op([1])]);
    expect(q.overlayOps()).toHaveLength(1);
    q.retireInFlight();
    expect(q.overlayOps()).toHaveLength(0);
  });

  it('handleDrop requests fresh state and retires in-flight without replaying them', () => {
    const s = fakeSocket();
    const { q } = queueHarness(() => s.socket);
    q.enqueue([op([1])]);
    expect(q.overlayOps()).toHaveLength(1);

    q.handleDrop('map-1');
    expect(s.stateRequests).toEqual([{ mapId: 'map-1' }]);
    expect(q.overlayOps()).toHaveLength(0);
  });

  it('acknowledges in-flight chunks incrementally when snapshot reflects their changes', () => {
    const s = fakeSocket();
    const { q, advance } = queueHarness(() => s.socket);
    q.enqueue([op([0, 1]), op([2, 3])]);
    advance(100);
    expect(q.pending()).toEqual([]);
    expect(q.overlayOps()).toHaveLength(2);

    const fog = (revealed: boolean[]) => ({ fogCols: revealed.length, fogRows: 1, cellPx: 32, revealed });

    const partial = fog([true, true, false, false]);
    const advanced = q.ackEcho(false, partial);
    expect(advanced).toBe(true);
    expect(q.overlayOps()).toHaveLength(1);
    expect(q.overlayOps()[0]).toEqual(op([2, 3]));

    const full = fog([true, true, true, true]);
    const fullAdvanced = q.ackEcho(true, full);
    expect(fullAdvanced).toBe(true);
    expect(q.overlayOps()).toHaveLength(0);
  });

  it('detects when in-flight operations have timed out', () => {
    const s = fakeSocket();
    const { q, advance } = queueHarness(() => s.socket);
    q.enqueue([op([1])]);
    expect(q.hasTimedOut()).toBe(false);
    advance(5000);
    expect(q.hasTimedOut()).toBe(true);
  });

  it('does not acknowledge in-flight chunk when snapshot does not reflect it', () => {
    const s = fakeSocket();
    const { q } = queueHarness(() => s.socket);
    q.enqueue([op([5])]);
    const fog = (revealed: boolean[]) => ({ fogCols: revealed.length, fogRows: 1, cellPx: 32, revealed });
    const unrelated = fog([false, false, false, false, false, false]);
    const advanced = q.ackEcho(false, unrelated);
    expect(advanced).toBe(false);
    expect(q.overlayOps()).toHaveLength(1);
    expect(q.hasTimedOut()).toBe(false);
  });
});
