/**
 * Frozen game-system sheets (ADR 0013 T4).
 *
 * A frozen system stays readable, assignable, and deletable. Create, template
 * publish, sheet edits, and live resource patches are refused until the sheet
 * UI and an attribution section exist. This module is the predicate and the
 * stable error payload; HTTP and WebSocket wiring live elsewhere.
 *
 * Compare against the enum string, not `GameSystem` from `./index`, so this
 * file cannot cycle with the type index.
 */

export const GAME_SYSTEM_SHEET_FROZEN_CODE = 'GAME_SYSTEM_SHEET_FROZEN';

export const GAME_SYSTEM_SHEET_FROZEN_MESSAGE =
  'Shadowrun 6e Characters cannot be created or edited until the sheet and an attribution section exist.';

export function isGameSystemSheetFrozen(gameSystem: string | null | undefined): boolean {
  return gameSystem === 'SHADOWRUN_6E';
}

export function gameSystemSheetFrozenError(): {
  error: 'Bad Request';
  code: typeof GAME_SYSTEM_SHEET_FROZEN_CODE;
  message: typeof GAME_SYSTEM_SHEET_FROZEN_MESSAGE;
} {
  return {
    error: 'Bad Request',
    code: GAME_SYSTEM_SHEET_FROZEN_CODE,
    message: GAME_SYSTEM_SHEET_FROZEN_MESSAGE,
  };
}
