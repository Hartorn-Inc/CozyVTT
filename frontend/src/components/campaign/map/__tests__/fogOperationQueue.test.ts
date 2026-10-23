/**
 * Ordered fog:operation queue. A later rectangle is appended, not a cancel
 * of earlier chunks. Drain always asks getSocket() at fire time.
 */

import { describe, it, expect } from 'vitest';
import { createFogOperationQueue, type FogCellOperation, type FogOperationSocket } from '../fogOperationQueue';

function op(cells: number[], mapId = 'map-1'): FogCellOperation {
  return { mapId, op: 'reveal', cells };
}

function fakeSocket() {
  const emitted: Array<{ mapId: string; operation: { op: string; cells: number[] } }> = [];
  const socket: FogOperationSocket = {
    emit(_event, data) { emitted.push(data); },
  };
  return { socket, emitted };
}

function queueHarness(getSocket: () => FogOperationSocket | null | undefined) {
  let t = 0;
  const scheduled: Array<{ fire: () => void; delay: number }> = [];
  const q = createFogOperationQueue({
    getSocket,
    gapMs: 100,
    now: () => t,
    schedule: (fn, delayMs) => {
      const item = { fire: fn, delay: delayMs };
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
    advance(ms: number) {
      t += ms;
      const due = scheduled.filter((s) => s.delay <= ms);
      for (const s of due) {
        const i = scheduled.indexOf(s);
        if (i !== -1) scheduled.splice(i, 1);
        s.fire();
      }
      for (const s of scheduled) s.delay -= ms;
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

  it('clear drops pending cell ops so reveal_all cannot be followed by a late hide', () => {
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
});

describe('noteEmit', () => {
  it('makes the next cell op wait the gap after a reveal_all', () => {
    const s = fakeSocket();
    const { q, scheduled } = queueHarness(() => s.socket);
    q.noteEmit();
    q.enqueue([op([4])]);
    expect(s.emitted).toHaveLength(0);
    expect(scheduled[0]?.delay).toBe(100);
  });
});
