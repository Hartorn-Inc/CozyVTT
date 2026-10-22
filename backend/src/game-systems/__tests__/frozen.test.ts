import {
  GAME_SYSTEM_SHEET_FROZEN_CODE,
  GAME_SYSTEM_SHEET_FROZEN_MESSAGE,
  gameSystemSheetFrozenError,
  isGameSystemSheetFrozen,
} from '../frozen';

describe('isGameSystemSheetFrozen', () => {
  it('pins the stable refusal code and message', () => {
    expect(GAME_SYSTEM_SHEET_FROZEN_CODE).toBe('GAME_SYSTEM_SHEET_FROZEN');
    expect(GAME_SYSTEM_SHEET_FROZEN_MESSAGE).toBe(
      'Shadowrun 6e Characters cannot be created or edited until the sheet and an attribution section exist.',
    );
  });

  it('is true only for Shadowrun 6e', () => {
    expect(isGameSystemSheetFrozen('SHADOWRUN_6E')).toBe(true);
    expect(isGameSystemSheetFrozen('DND_5E')).toBe(false);
    expect(isGameSystemSheetFrozen('PATHFINDER_2E')).toBe(false);
    expect(isGameSystemSheetFrozen('CALL_OF_CTHULHU_7E')).toBe(false);
    expect(isGameSystemSheetFrozen(null)).toBe(false);
    expect(isGameSystemSheetFrozen(undefined)).toBe(false);
  });

  it('returns the Bad Request payload other builders send when frozen', () => {
    expect(gameSystemSheetFrozenError()).toEqual({
      error: 'Bad Request',
      code: GAME_SYSTEM_SHEET_FROZEN_CODE,
      message: GAME_SYSTEM_SHEET_FROZEN_MESSAGE,
    });
  });
});
