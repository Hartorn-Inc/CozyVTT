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
  const socket: FogOperationSocket = {
    emit(_event, data) { emitted.push(data); },
  };
  return { socket, emitted };
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

  it('11th emit waits until the sliding window has room', () => {
    const s = fakeSocket();
    const { q, advance } = queueHarness(() => s.socket);
    q.enqueue(Array.from({ length: 11 }, (_, i) => op([i])));
    expect(s.emitted).toHaveLength(1);
    for (let i = 0; i < 9; i++) advance(100);
    expect(s.emitted).toHaveLength(10);
    advance(100);
    expect(s.emitted).toHaveLength(10);
    advance(50);
    expect(s.emitted).toHaveLength(11);
    expect(s.emitted[10]?.operation.cells).toEqual([10]);
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
    expect(s.emitted).toHaveLength(10);

    q.enqueueAll('map-1', 'reveal_all');
    expect(s.emitted).toHaveLength(10);
    expect(s.emitted.some((e) => e.operation.op === 'reveal_all')).toBe(false);

    advance(150);
    expect(s.emitted).toHaveLength(11);
    expect(s.emitted[10]).toEqual({ mapId: 'map-1', operation: { op: 'reveal_all' } });
    expect(q.pending()).toEqual([]);
  });

  it('does not emit hide_all at t=0 when the window is full, then drops leftover cells', () => {
    const s = fakeSocket();
    const { q, advance } = queueHarness(() => s.socket);
    q.enqueue(Array.from({ length: 10 }, (_, i) => op([i])));
    for (let i = 0; i < 9; i++) advance(100);
    q.enqueue([op([99])]);
    q.enqueueAll('map-1', 'hide_all');
    expect(s.emitted).toHaveLength(10);
    expect(q.pending().map((p) => p.cells)).toEqual([[99]]);

    advance(150);
    expect(s.emitted[10]).toEqual({ mapId: 'map-1', operation: { op: 'hide_all' } });
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
    for (let i = 0; i < 9; i++) advance(100);
    q.enqueue([op([99])]);
    q.enqueueAll('map-1', 'hide_all');
    q.enqueue([op([42], 'map-1')]);
    expect(s.emitted).toHaveLength(10);
    expect(q.overlayOps().map((o) => o.op)).toEqual([
      ...Array.from({ length: 10 }, () => 'reveal'),
      'hide_all',
      'reveal',
    ]);
    const overlay = q.overlayOps();
    expect(overlay[overlay.length - 1]).toEqual(op([42]));

    advance(150);
    expect(s.emitted[10]).toEqual({ mapId: 'map-1', operation: { op: 'hide_all' } });
    expect(s.emitted.some((e) => e.operation.cells?.[0] === 99)).toBe(false);
    expect(q.pending().map((p) => p.cells)).toEqual([[42]]);

    advance(100);
    expect(s.emitted[11]).toEqual({ mapId: 'map-1', operation: { op: 'reveal', cells: [42] } });
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
});
