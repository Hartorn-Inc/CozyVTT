/**
 * Deleted login-session ids stay blocked for the remember-me window so a
 * later store write cannot revive them, and the map forgets them after that.
 */

import { rememberMeMaxAge } from '../../config/sessionDurations';
import { blockLoginSessions, isLoginSessionBlocked, unblockLoginSessions } from '../revokedLoginSessions';

it('blocks the sids it is given and no others', () => {
  const sid = `revoked-unit-${Date.now()}-a`;
  expect(isLoginSessionBlocked(sid)).toBe(false);
  blockLoginSessions([sid]);
  expect(isLoginSessionBlocked(sid)).toBe(true);
  expect(isLoginSessionBlocked(`${sid}-other`)).toBe(false);
});

it('unblocks only the sids it is given', () => {
  const kept = `revoked-unit-${Date.now()}-keep`;
  const freed = `revoked-unit-${Date.now()}-free`;
  blockLoginSessions([kept, freed]);
  unblockLoginSessions([freed]);
  expect(isLoginSessionBlocked(kept)).toBe(true);
  expect(isLoginSessionBlocked(freed)).toBe(false);
});

it('forgets a blocked sid after rememberMeMaxAge', () => {
  jest.useFakeTimers();
  const sid = `revoked-unit-${Date.now()}-ttl`;
  try {
    blockLoginSessions([sid]);
    expect(isLoginSessionBlocked(sid)).toBe(true);
    jest.advanceTimersByTime(rememberMeMaxAge + 1);
    expect(isLoginSessionBlocked(sid)).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});
