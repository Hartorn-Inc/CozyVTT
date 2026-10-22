/**
 * Write-side parse for a character sheet: migrate, stamp identity, validate.
 * Projection and Keeper's Notes stripping are not this helper's job.
 */

import { GameSystem } from '../../game-systems';
import { getBlankCharacterTemplate } from '../../validators/game-systems';
import { SHEET_LIST_MAX } from '../../validators/game-systems/sheetLimits';
import { prepareSheetForStorage } from '../prepareSheet';

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
      expect(result.data).toMatchObject({ investigatorName: 'New Investigator' });
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
