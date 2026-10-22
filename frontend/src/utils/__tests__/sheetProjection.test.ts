/**
 * Read-side projection of derived values. The backend copy is pinned
 * byte-for-byte; these lock the numbers the views and initiative use.
 */

import { describe, it, expect } from 'vitest';
import { projectCharacterData } from '../sheetProjection';

describe('Pathfinder 2e projection', () => {
  it('projects max HP from ancestry, class, level and CON, and leaves current HP', () => {
    const projected = projectCharacterData('PATHFINDER_2E', {
      level: 1,
      attributes: { constitution: { score: 14, modifier: 2 } },
      hp: {
        maximum: 1,
        current: 7,
        temporary: 3,
        ancestryHp: 10,
        classHpPerLevel: 10,
      },
    }) as { hp: { maximum: number; current: number; temporary: number } };

    // ancestryHp + classHpPerLevel * level + conMod * level = 10 + 10*1 + 2*1 = 22
    expect(projected.hp.maximum).toBe(22);
    expect(projected.hp.current).toBe(7);
    expect(projected.hp.temporary).toBe(3);
  });
});

describe('Call of Cthulhu 7e projection', () => {
  it('projects max HP from CON and SIZ, and leaves current HP', () => {
    const projected = projectCharacterData('CALL_OF_CTHULHU_7E', {
      characteristics: {
        CON: { regular: 70, half: 35, fifth: 14 },
        SIZ: { regular: 80, half: 40, fifth: 16 },
      },
      derivedStats: {
        hp: { maximum: 3, current: 7, majorWoundThreshold: 1, formula: '(CON + SIZ) / 10' },
      },
    }) as { derivedStats: { hp: { maximum: number; current: number } } };

    expect(projected.derivedStats.hp.maximum).toBe(15);
    expect(projected.derivedStats.hp.current).toBe(7);
  });

  it('clamps Mythos 100 to sanity maximum 0', () => {
    const projected = projectCharacterData('CALL_OF_CTHULHU_7E', {
      skills: { cthulhuMythos: { currentValue: 100 } },
      derivedStats: { sanity: { starting: 50, maximum: 99, current: 40 } },
    }) as { derivedStats: { sanity: { maximum: number; current: number; starting: number } } };

    expect(projected.derivedStats.sanity.maximum).toBe(0);
    expect(projected.derivedStats.sanity.current).toBe(40);
    expect(projected.derivedStats.sanity.starting).toBe(50);
  });

  it('does not create derivedStats when the stored sheet omitted it', () => {
    const projected = projectCharacterData('CALL_OF_CTHULHU_7E', {
      characteristics: {
        CON: { regular: 70, half: 35, fifth: 14 },
        SIZ: { regular: 80, half: 40, fifth: 16 },
        POW: { regular: 50, half: 25, fifth: 10 },
      },
      skills: { cthulhuMythos: { currentValue: 8 } },
    }) as { derivedStats?: unknown };

    expect(projected).not.toHaveProperty('derivedStats');
  });
});
