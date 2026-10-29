import { describe, it, expect } from 'vitest';
import {
  cocHitPoints,
  cocMagicPoints,
  cocMaxSanity,
  cocHalfAndFifth,
  cocDamageBonusAndBuild,
  cocMoveRate,
} from '../rules/callOfCthulhu7e';

describe('cocDamageBonusAndBuild', () => {
  it.each([
    [15, 15, '-2', -2],
    [30, 34, '-2', -2],
    [40, 44, '-1', -1],
    [50, 50, '0', 0],
    [60, 64, '0', 0],
    [80, 80, '+1d4', 1],
    [100, 100, '+1d6', 2],
    [140, 140, '+2d6', 3],
    [180, 180, '+3d6', 4],
    [220, 220, '+4d6', 5],
    [250, 274, '+5d6', 6],
    [262, 262, '+5d6', 6],
  ])('STR %i + SIZ %i gives damage bonus %s and build %i', (str, siz, damageBonus, build) => {
    expect(cocDamageBonusAndBuild(str, siz)).toEqual({ damageBonus, build });
  });

  it('verifies exact boundary values at and above 524', () => {
    expect(cocDamageBonusAndBuild(262, 262)).toEqual({ damageBonus: '+5d6', build: 6 });
    expect(cocDamageBonusAndBuild(262, 263)).toEqual({ damageBonus: '+6d6', build: 7 });
    expect(cocDamageBonusAndBuild(300, 304)).toEqual({ damageBonus: '+6d6', build: 7 });
    expect(cocDamageBonusAndBuild(300, 305)).toEqual({ damageBonus: '+7d6', build: 8 });
    expect(cocDamageBonusAndBuild(500, 500)).toEqual({ damageBonus: '+11d6', build: 12 });
  });
});

describe('cocHitPoints', () => {
  it('calculates HP as (CON + SIZ) / 10 rounded down', () => {
    expect(cocHitPoints(50, 50)).toBe(10);
    expect(cocHitPoints(55, 54)).toBe(10);
    expect(cocHitPoints(65, 65)).toBe(13);
  });
});

describe('cocMagicPoints', () => {
  it('calculates MP as POW / 5 rounded down', () => {
    expect(cocMagicPoints(50)).toBe(10);
    expect(cocMagicPoints(54)).toBe(10);
    expect(cocMagicPoints(99)).toBe(19);
  });
});

describe('cocMaxSanity', () => {
  it('calculates 99 - Cthulhu Mythos held to [0, 99]', () => {
    expect(cocMaxSanity(0)).toBe(99);
    expect(cocMaxSanity(10)).toBe(89);
    expect(cocMaxSanity(99)).toBe(0);
    expect(cocMaxSanity(100)).toBe(0);
  });
});

describe('cocHalfAndFifth', () => {
  it('calculates half and fifth values rounded down', () => {
    expect(cocHalfAndFifth(50)).toEqual({ half: 25, fifth: 10 });
    expect(cocHalfAndFifth(65)).toEqual({ half: 32, fifth: 13 });
  });
});

describe('cocMoveRate', () => {
  it('calculates Move Rate according to STR, DEX, SIZ and age', () => {
    expect(cocMoveRate(60, 60, 50, 25)).toBe(9);
    expect(cocMoveRate(40, 40, 50, 25)).toBe(7);
    expect(cocMoveRate(60, 40, 50, 25)).toBe(8);
    expect(cocMoveRate(60, 60, 50, 45)).toBe(8);
    expect(cocMoveRate(60, 60, 50, 85)).toBe(4);
    expect(cocMoveRate(20, 20, 80, 85)).toBe(2);
  });
});
