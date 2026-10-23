/**
 * Fog / explored-memory cell arrays cap at 20,000 per message.
 * Expected sizes are literals, not the production constant.
 */

import { FogOperationSchema, ExplorationRevealSchema } from '../walls';

const mapId = '00000000-0000-4000-8000-000000000001';

describe('FogOperationSchema cell cap', () => {
  it('accepts a 20000-cell reveal and hide', () => {
    const cells = Array.from({ length: 20000 }, (_, i) => i);
    expect(FogOperationSchema.safeParse({ op: 'reveal', cells }).success).toBe(true);
    expect(FogOperationSchema.safeParse({ op: 'hide', cells }).success).toBe(true);
  });

  it('refuses a 20001-cell reveal and hide', () => {
    const cells = Array.from({ length: 20001 }, (_, i) => i);
    expect(FogOperationSchema.safeParse({ op: 'reveal', cells }).success).toBe(false);
    expect(FogOperationSchema.safeParse({ op: 'hide', cells }).success).toBe(false);
  });

  it('does not cap reveal_all or hide_all', () => {
    expect(FogOperationSchema.safeParse({ op: 'reveal_all' }).success).toBe(true);
    expect(FogOperationSchema.safeParse({ op: 'hide_all' }).success).toBe(true);
  });
});

describe('ExplorationRevealSchema cell cap', () => {
  it('accepts 20000 cells and refuses 20001', () => {
    expect(ExplorationRevealSchema.safeParse({
      mapId, cells: Array.from({ length: 20000 }, (_, i) => i),
    }).success).toBe(true);
    expect(ExplorationRevealSchema.safeParse({
      mapId, cells: Array.from({ length: 20001 }, (_, i) => i),
    }).success).toBe(false);
  });
});
