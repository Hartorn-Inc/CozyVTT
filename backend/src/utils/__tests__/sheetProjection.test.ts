/**
 * Read-side projection of derived values on a character sheet.
 *
 * Stored caches can go stale when an input changes and the editor has not
 * re-saved. Projection at read is what keeps the view, REST, character.updated
 * and initiative on the same numbers, without overwriting current resources.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { projectCharacterData } from '../sheetProjection';
import { resolveCharacterInitiative } from '../rules/initiative';

describe('parity with the frontend copy', () => {
  it('is byte-for-byte identical to frontend/src/utils/sheetProjection.ts', () => {
    const backendCopy = readFileSync(path.resolve(__dirname, '../sheetProjection.ts'), 'utf8');
    const frontendCopy = readFileSync(
      path.resolve(__dirname, '../../../../frontend/src/utils/sheetProjection.ts'),
      'utf8'
    );
    expect(backendCopy).toBe(frontendCopy);
  });

  it('rules/callOfCthulhu7e.ts is byte-for-byte identical to the frontend copy', () => {
    const backendCopy = readFileSync(path.resolve(__dirname, '../rules/callOfCthulhu7e.ts'), 'utf8');
    const frontendCopy = readFileSync(
      path.resolve(__dirname, '../../../../frontend/src/utils/rules/callOfCthulhu7e.ts'),
      'utf8'
    );
    expect(backendCopy).toBe(frontendCopy);
  });
});

describe('projectCharacterData', () => {
  it('returns a non-object unchanged', () => {
    expect(projectCharacterData('PATHFINDER_2E', null)).toBeNull();
    expect(projectCharacterData('PATHFINDER_2E', 12)).toBe(12);
    expect(projectCharacterData('DND_5E', ['hp'])).toEqual(['hp']);
  });

  it('returns Flexible and unknown systems unchanged', () => {
    const sheet = { hp: { maximum: 1, current: 1 } };
    expect(projectCharacterData(null, sheet)).toBe(sheet);
    expect(projectCharacterData('SHADOWRUN_6E', sheet)).toBe(sheet);
    expect(projectCharacterData('SOMETHING_ELSE', sheet)).toBe(sheet);
  });

  it('does not mutate the input', () => {
    const data = {
      level: 1,
      attributes: { constitution: { score: 14, modifier: 2 } },
      hp: {
        maximum: 1,
        current: 7,
        temporary: 3,
        ancestryHp: 10,
        classHpPerLevel: 10,
      },
    };
    const before = JSON.parse(JSON.stringify(data)) as typeof data;
    projectCharacterData('PATHFINDER_2E', data);
    expect(data).toEqual(before);
  });
});

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

  it('leaves stored max HP when ancestry or class HP is missing', () => {
    const projected = projectCharacterData('PATHFINDER_2E', {
      level: 1,
      attributes: { constitution: { score: 14, modifier: 2 } },
      hp: { maximum: 1, current: 7, ancestryHp: 10 },
    }) as { hp: { maximum: number; current: number } };

    expect(projected.hp.maximum).toBe(1);
    expect(projected.hp.current).toBe(7);
  });

  it('clamps a projected maximum of 0 up to 1', () => {
    const projected = projectCharacterData('PATHFINDER_2E', {
      level: 1,
      attributes: { constitution: { score: 8, modifier: -1 } },
      hp: { maximum: 9, current: 4, ancestryHp: 0, classHpPerLevel: 0 },
    }) as { hp: { maximum: number; current: number } };

    expect(projected.hp.maximum).toBe(1);
    expect(projected.hp.current).toBe(4);
  });

  it('projects Perception so initiative uses the live bonus, not a stale cache', () => {
    const sheet = {
      level: 1,
      attributes: {
        wisdom: { score: 18, modifier: 4 },
      },
      perception: { proficiencyRank: 'expert', itemBonus: 0, bonus: 0, senses: [] },
      initiative: { usedStat: 'perception', bonus: 0 },
    };

    const projected = projectCharacterData('PATHFINDER_2E', sheet) as {
      perception: { bonus: number };
      initiative: { bonus: number };
    };
    expect(projected.perception.bonus).toBe(9);
    expect(projected.initiative.bonus).toBe(9);
    expect(resolveCharacterInitiative('PATHFINDER_2E', sheet)).toEqual({
      kind: 'roll',
      expression: '1d20+9',
      label: '1d20+9',
    });
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
        luck: { score: 44, notes: '' },
      },
    }) as {
      derivedStats: {
        hp: { maximum: number; current: number; majorWoundThreshold: number };
        luck: { score: number };
      };
    };

    expect(projected.derivedStats.hp.maximum).toBe(15);
    expect(projected.derivedStats.hp.majorWoundThreshold).toBe(7);
    expect(projected.derivedStats.hp.current).toBe(7);
    expect(projected.derivedStats.luck.score).toBe(44);
  });

  it('clamps Mythos 100 to sanity maximum 0 and leaves current and starting', () => {
    const projected = projectCharacterData('CALL_OF_CTHULHU_7E', {
      skills: { cthulhuMythos: { baseValue: 0, currentValue: 100, improvementChecked: false } },
      derivedStats: {
        sanity: { starting: 50, maximum: 99, current: 40, formula: 'POW' },
      },
    }) as {
      derivedStats: { sanity: { starting: number; maximum: number; current: number } };
      skills: { cthulhuMythos: { currentValue: number } };
    };

    expect(projected.derivedStats.sanity.maximum).toBe(0);
    expect(projected.derivedStats.sanity.current).toBe(40);
    expect(projected.derivedStats.sanity.starting).toBe(50);
    expect(projected.skills.cthulhuMythos.currentValue).toBe(100);
  });

  it('copies Dodge from the skill without rewriting the skill', () => {
    const projected = projectCharacterData('CALL_OF_CTHULHU_7E', {
      skills: { dodge: { baseValue: 25, currentValue: 45, improvementChecked: false } },
      derivedStats: {
        dodge: { value: 25, formula: 'DEX / 2', improvementChecked: false },
      },
    }) as {
      skills: { dodge: { baseValue: number; currentValue: number } };
      derivedStats: { dodge: { value: number } };
    };

    expect(projected.derivedStats.dodge.value).toBe(45);
    expect(projected.skills.dodge.currentValue).toBe(45);
    expect(projected.skills.dodge.baseValue).toBe(25);
  });

  it('does not create derivedStats when the stored sheet omitted it', () => {
    const projected = projectCharacterData('CALL_OF_CTHULHU_7E', {
      characteristics: {
        CON: { regular: 70, half: 0, fifth: 0 },
        SIZ: { regular: 80, half: 0, fifth: 0 },
        POW: { regular: 50, half: 0, fifth: 0 },
      },
      skills: { cthulhuMythos: { currentValue: 8 } },
    }) as {
      derivedStats?: unknown;
      characteristics: {
        CON: { regular: number; half: number; fifth: number };
        SIZ: { regular: number; half: number; fifth: number };
        POW: { regular: number; half: number; fifth: number };
      };
    };

    expect(projected).not.toHaveProperty('derivedStats');
    expect(projected.characteristics.CON).toEqual({ regular: 70, half: 35, fifth: 14 });
    expect(projected.characteristics.SIZ).toEqual({ regular: 80, half: 40, fifth: 16 });
    expect(projected.characteristics.POW).toEqual({ regular: 50, half: 25, fifth: 10 });
  });
});

describe('D&D 5e projection', () => {
  const sheet = {
    level: 5,
    proficiencyBonus: 3,
    stats: {
      dexterity: { score: 16, modifier: 3 },
      wisdom: { score: 12, modifier: 1 },
    },
    hp: { maximum: 27, current: 11, temporary: 4 },
    hitDice: [{ class: 'fighter', die: 'd10', maximum: 5, remaining: 2 }],
    skills: {
      stealth: { proficient: true, expertise: true, bonus: 99 },
    },
    savingThrows: {
      wisdom: { proficient: true, bonus: 99 },
    },
  };

  it('leaves a stored bonus when otherBonus is absent', () => {
    const projected = projectCharacterData('DND_5E', sheet) as typeof sheet;
    expect(projected.skills.stealth.bonus).toBe(99);
    expect(projected.savingThrows.wisdom.bonus).toBe(99);
    expect(projected.hp.current).toBe(11);
    expect(projected.hp.temporary).toBe(4);
    expect(projected.hp.maximum).toBe(27);
    expect(projected.hitDice[0].remaining).toBe(2);
  });

  it('overwrites bonus only once otherBonus is present', () => {
    const projected = projectCharacterData('DND_5E', {
      ...sheet,
      skills: { stealth: { proficient: true, expertise: true, bonus: 99, otherBonus: 1 } },
      savingThrows: { wisdom: { proficient: true, bonus: 99, otherBonus: 0 } },
    }) as typeof sheet & {
      skills: { stealth: { bonus: number } };
      savingThrows: { wisdom: { bonus: number } };
    };

    expect(projected.skills.stealth.bonus).toBe(10);
    expect(projected.savingThrows.wisdom.bonus).toBe(4);
    expect(projected.hitDice[0].remaining).toBe(2);
  });
});
