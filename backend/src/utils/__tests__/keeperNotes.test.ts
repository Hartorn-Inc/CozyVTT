/**
 * The sheet a reader is sent: derived values projected, then Keeper's Notes
 * filtered. The stored row is left as it was.
 */

import { GameSystem } from '@prisma/client';
import { characterForReader, sheetWithoutKeeperNotes } from '../keeperNotes';

describe('characterForReader', () => {
  it('projects Pathfinder max HP for any reader and leaves current HP', () => {
    const character = {
      gameSystem: GameSystem.PATHFINDER_2E,
      data: {
        level: 1,
        attributes: { constitution: { score: 14, modifier: 2 } },
        hp: { maximum: 1, current: 7, temporary: 0, ancestryHp: 10, classHpPerLevel: 10 },
      },
    };
    const stored = JSON.parse(JSON.stringify(character.data)) as typeof character.data;

    const read = characterForReader(character, false);
    expect((read.data as { hp: { maximum: number; current: number } }).hp.maximum).toBe(22);
    expect((read.data as { hp: { maximum: number; current: number } }).hp.current).toBe(7);
    expect(character.data).toEqual(stored);
  });

  it('projects Call of Cthulhu max HP then drops Keeper\'s Notes for anyone but the Keeper', () => {
    const character = {
      gameSystem: GameSystem.CALL_OF_CTHULHU_7E,
      data: {
        characteristics: {
          CON: { regular: 70, half: 35, fifth: 14 },
          SIZ: { regular: 80, half: 40, fifth: 16 },
        },
        derivedStats: {
          hp: { maximum: 3, current: 7, majorWoundThreshold: 1, formula: '' },
        },
        notes: 'A cultist.',
      },
    };

    const player = characterForReader(character, false);
    expect((player.data as { derivedStats: { hp: { maximum: number; current: number } } }).derivedStats.hp.maximum).toBe(
      15
    );
    expect((player.data as { derivedStats: { hp: { current: number } } }).derivedStats.hp.current).toBe(7);
    expect(player.data).not.toHaveProperty('notes');

    const keeper = characterForReader(character, true);
    expect((keeper.data as { notes: string }).notes).toBe('A cultist.');
    expect((keeper.data as { derivedStats: { hp: { maximum: number } } }).derivedStats.hp.maximum).toBe(15);
    expect((character.data as { notes: string }).notes).toBe('A cultist.');
  });
});

describe('sheetWithoutKeeperNotes', () => {
  it('still drops notes without projecting', () => {
    const data = { notes: 'secret', derivedStats: { hp: { maximum: 3, current: 7 } } };
    expect(sheetWithoutKeeperNotes(GameSystem.CALL_OF_CTHULHU_7E, data)).toEqual({
      derivedStats: { hp: { maximum: 3, current: 7 } },
    });
  });
});
