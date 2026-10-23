/**
 * Write-side parse for a character sheet: migrate, stamp identity, validate.
 * Projection and Keeper's Notes stripping are not this helper's job.
 */

import { GameSystem } from '../../game-systems';
import { getBlankCharacterTemplate } from '../../validators/game-systems';
import { SHEET_LIST_MAX } from '../../validators/game-systems/sheetLimits';
import { acceptLiveSheetPatch, prepareSheetForStorage, sheetRecord } from '../prepareSheet';

const rows = (count: number, row: unknown) => Array.from({ length: count }, () => row);

describe('prepareSheetForStorage', () => {
  it('parses a valid Pathfinder 2e sheet', () => {
    const data = getBlankCharacterTemplate(GameSystem.PATHFINDER_2E);
    const result = prepareSheetForStorage({ gameSystem: GameSystem.PATHFINDER_2E, data });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ characterName: 'New Character', level: 1 });
    }
  });

  it('parses a valid Call of Cthulhu 7e sheet', () => {
    const data = getBlankCharacterTemplate(GameSystem.CALL_OF_CTHULHU_7E);
    const result = prepareSheetForStorage({ gameSystem: GameSystem.CALL_OF_CTHULHU_7E, data });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ investigatorName: 'Blank Investigator' });
    }
  });

  it('stamps the character name and player display name onto a Pathfinder sheet', () => {
    const data = getBlankCharacterTemplate(GameSystem.PATHFINDER_2E);
    const result = prepareSheetForStorage({
      gameSystem: GameSystem.PATHFINDER_2E,
      data,
      identity: { name: 'Seelah', playerDisplayName: 'Anevia' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ characterName: 'Seelah', playerName: 'Anevia' });
    }
  });

  it('stamps the investigator name onto a Call of Cthulhu sheet', () => {
    const data = getBlankCharacterTemplate(GameSystem.CALL_OF_CTHULHU_7E);
    const result = prepareSheetForStorage({
      gameSystem: GameSystem.CALL_OF_CTHULHU_7E,
      data,
      identity: { name: 'Harvey Walters', playerDisplayName: 'Tyke' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ investigatorName: 'Harvey Walters', playerName: 'Tyke' });
    }
  });

  it('refuses a Pathfinder inventory over the list limit, naming the list', () => {
    const data = {
      ...getBlankCharacterTemplate(GameSystem.PATHFINDER_2E),
      inventory: rows(SHEET_LIST_MAX + 1, { name: 'Rope' }),
    };
    const result = prepareSheetForStorage({ gameSystem: GameSystem.PATHFINDER_2E, data });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('Character data does not match game system schema');
      expect(result.validationErrors).toEqual([
        {
          path: 'inventory',
          message: `Can hold at most ${SHEET_LIST_MAX} entries`,
          code: 'too_big',
        },
      ]);
    }
  });

  it('refuses Call of Cthulhu possessions over the list limit, naming the list', () => {
    const data = {
      ...getBlankCharacterTemplate(GameSystem.CALL_OF_CTHULHU_7E),
      possessions: rows(SHEET_LIST_MAX + 1, { name: 'Lantern' }),
    };
    const result = prepareSheetForStorage({ gameSystem: GameSystem.CALL_OF_CTHULHU_7E, data });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('Character data does not match game system schema');
      expect(result.validationErrors).toEqual([
        {
          path: 'possessions',
          message: `Can hold at most ${SHEET_LIST_MAX} entries`,
          code: 'too_big',
        },
      ]);
    }
  });

  it('does not project derived values on write', () => {
    const blank = getBlankCharacterTemplate(GameSystem.PATHFINDER_2E);
    expect('hp' in blank).toBe(true);
    if (!('hp' in blank)) return;
    const data = {
      ...blank,
      hp: {
        ...blank.hp,
        maximum: 1,
        current: 7,
        ancestryHp: 10,
        classHpPerLevel: 10,
      },
    };
    const result = prepareSheetForStorage({ gameSystem: GameSystem.PATHFINDER_2E, data });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hp = (result.data as { hp: { maximum: number; current: number } }).hp;
      expect(hp.maximum).toBe(1);
      expect(hp.current).toBe(7);
    }
  });

  it('keeps Keeper\'s Notes on a Call of Cthulhu parse', () => {
    const data = {
      ...getBlankCharacterTemplate(GameSystem.CALL_OF_CTHULHU_7E),
      notes: 'The investigator is a cultist.',
    };
    const result = prepareSheetForStorage({ gameSystem: GameSystem.CALL_OF_CTHULHU_7E, data });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as { notes: string }).notes).toBe('The investigator is a cultist.');
    }
  });

  it('refuses a Flexible sheet that is not an object, with the Flexible message', () => {
    const result = prepareSheetForStorage({ gameSystem: null, data: 'not a sheet' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('Character data does not match the Flexible sheet layout');
      expect(result.validationErrors.length).toBeGreaterThan(0);
    }
  });

  it('parses a Flexible object as sent, without identity wrapping', () => {
    const result = prepareSheetForStorage({
      gameSystem: null,
      data: { sections: [] },
      identity: { name: 'Aldra', playerDisplayName: 'Tyke' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ sections: [] });
    }
  });
});

function dndBlank(): Record<string, unknown> {
  return getBlankCharacterTemplate(GameSystem.DND_5E) as Record<string, unknown>;
}

function withHpCurrent(sheet: Record<string, unknown>, current: unknown): Record<string, unknown> {
  const hp = sheet.hp;
  expect(hp !== null && typeof hp === 'object' && !Array.isArray(hp)).toBe(true);
  if (hp === null || typeof hp !== 'object' || Array.isArray(hp)) return sheet;
  return { ...sheet, hp: { ...hp, current } };
}

function withHitDieRemaining(
  sheet: Record<string, unknown>,
  remaining: number
): Record<string, unknown> {
  const hitDice = sheet.hitDice;
  expect(Array.isArray(hitDice)).toBe(true);
  if (!Array.isArray(hitDice) || hitDice.length === 0) return sheet;
  const first = hitDice[0];
  expect(first !== null && typeof first === 'object' && !Array.isArray(first)).toBe(true);
  if (first === null || typeof first !== 'object' || Array.isArray(first)) return sheet;
  return { ...sheet, hitDice: [{ ...first, remaining }, ...hitDice.slice(1)] };
}

function overLimitDnD(): Record<string, unknown> {
  return {
    ...dndBlank(),
    inventory: rows(SHEET_LIST_MAX + 1, { name: 'Rope' }),
    extraKey: 'kept',
  };
}

function hpCurrentOf(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const hp = (data as Record<string, unknown>).hp;
  if (hp === null || typeof hp !== 'object' || Array.isArray(hp)) return undefined;
  return (hp as Record<string, unknown>).current;
}

function hitDieRemainingOf(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const hitDice = (data as Record<string, unknown>).hitDice;
  if (!Array.isArray(hitDice) || hitDice.length === 0) return undefined;
  const first = hitDice[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) return undefined;
  return (first as Record<string, unknown>).remaining;
}

describe('ADR 0013: live resource patch', () => {
  it('accepts a finite integer HP current change on a D&D 5e blank sheet', () => {
    const original = dndBlank();
    const patched = withHpCurrent(original, 7);
    const result = acceptLiveSheetPatch({
      gameSystem: GameSystem.DND_5E,
      original,
      patched,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(hpCurrentOf(result.data)).toBe(7);
    }
  });

  it('accepts the same HP change on a sheet whose inventory already exceeds the list limit', () => {
    const original = overLimitDnD();
    const patched = withHpCurrent(original, 7);
    const result = acceptLiveSheetPatch({
      gameSystem: GameSystem.DND_5E,
      original,
      patched,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(hpCurrentOf(result.data)).toBe(7);
      const data = result.data as Record<string, unknown>;
      expect(data.inventory).toEqual(original.inventory);
      expect(Array.isArray(data.inventory) ? data.inventory.length : 0).toBe(SHEET_LIST_MAX + 1);
      expect(data.extraKey).toBe('kept');
    }
  });

  it('still refuses that over-limit sheet on REST parse with the inventory too_big issue', () => {
    const data = overLimitDnD();
    const result = prepareSheetForStorage({ gameSystem: GameSystem.DND_5E, data });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('Character data does not match game system schema');
      expect(result.validationErrors).toEqual(
        expect.arrayContaining([
          {
            path: 'inventory',
            message: `Can hold at most ${SHEET_LIST_MAX} entries`,
            code: 'too_big',
          },
        ])
      );
    }
  });

  it('refuses a non-numeric or non-integer hp.current in the patched blob', () => {
    const original = dndBlank();
    const result = acceptLiveSheetPatch({
      gameSystem: GameSystem.DND_5E,
      original,
      patched: withHpCurrent(original, '7'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe('Character data does not match game system schema');
      expect(result.validationErrors.some((issue) => issue.path === 'hp.current')).toBe(true);
    }
  });

  it('refuses a fractional HP current such as 10.5', () => {
    const original = overLimitDnD();
    const result = acceptLiveSheetPatch({
      gameSystem: GameSystem.DND_5E,
      original,
      patched: withHpCurrent(original, 10.5),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.validationErrors.some((issue) => issue.path === 'hp.current')).toBe(true);
    }
  });

  it('accepts spending a hit die on an over-limit sheet', () => {
    const original = overLimitDnD();
    const remaining = hitDieRemainingOf(original);
    expect(typeof remaining).toBe('number');
    if (typeof remaining !== 'number') return;
    const patched = withHitDieRemaining(original, remaining - 1);
    const result = acceptLiveSheetPatch({
      gameSystem: GameSystem.DND_5E,
      original,
      patched,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(hitDieRemainingOf(result.data)).toBe(remaining - 1);
      const data = result.data as Record<string, unknown>;
      expect(Array.isArray(data.inventory) ? data.inventory.length : 0).toBe(SHEET_LIST_MAX + 1);
    }
  });

  it('accepts spending a hit die on a sheet whose hitDice list already exceeds the list limit', () => {
    const blank = dndBlank();
    const hitDice = blank.hitDice;
    expect(Array.isArray(hitDice) && hitDice.length > 0).toBe(true);
    if (!Array.isArray(hitDice) || hitDice.length === 0) return;
    const pool = hitDice[0];
    expect(pool !== null && typeof pool === 'object' && !Array.isArray(pool)).toBe(true);
    if (pool === null || typeof pool !== 'object' || Array.isArray(pool)) return;
    const original = { ...blank, hitDice: rows(SHEET_LIST_MAX + 1, pool) };
    const remaining = hitDieRemainingOf(original);
    expect(typeof remaining).toBe('number');
    if (typeof remaining !== 'number') return;
    const patched = withHitDieRemaining(original, remaining - 1);
    const live = acceptLiveSheetPatch({
      gameSystem: GameSystem.DND_5E,
      original,
      patched,
    });
    expect(live.ok).toBe(true);
    if (live.ok) {
      const data = live.data as Record<string, unknown>;
      expect(Array.isArray(data.hitDice) ? data.hitDice.length : 0).toBe(SHEET_LIST_MAX + 1);
      expect(hitDieRemainingOf(live.data)).toBe(remaining - 1);
    }
    const rest = prepareSheetForStorage({ gameSystem: GameSystem.DND_5E, data: original });
    expect(rest.ok).toBe(false);
    if (!rest.ok) {
      expect(rest.validationErrors).toEqual(
        expect.arrayContaining([
          {
            path: 'hitDice',
            message: `Can hold at most ${SHEET_LIST_MAX} entries`,
            code: 'too_big',
          },
        ])
      );
    }
  });

  it('refuses a new schema error the original did not have', () => {
    const original = overLimitDnD();
    const remaining = hitDieRemainingOf(original);
    expect(typeof remaining).toBe('number');
    if (typeof remaining !== 'number') return;
    const result = acceptLiveSheetPatch({
      gameSystem: GameSystem.DND_5E,
      original,
      patched: withHitDieRemaining(original, -1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.validationErrors.some((issue) => issue.path.endsWith('remaining'))).toBe(true);
      expect(result.validationErrors.some((issue) => issue.path === 'inventory')).toBe(false);
    }
  });
});

describe('sheetRecord', () => {
  it('returns a plain object as an indexable record', () => {
    const sheet = { hp: { maximum: 1 } };
    expect(sheetRecord(sheet)).toBe(sheet);
  });

  it('returns null for a non-object, an array, or null', () => {
    expect(sheetRecord(null)).toBeNull();
    expect(sheetRecord(12)).toBeNull();
    expect(sheetRecord([{ hp: 1 }])).toBeNull();
  });
});
