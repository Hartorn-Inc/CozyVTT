/**
 * The named `blank` starter in this directory is the only blank JSON.
 * `getBlankCharacterTemplate` aliases a clone of that registry data.
 */

import { GameSystem as PrismaGameSystem } from '@prisma/client';
import { GameSystem } from '../../../game-systems';
import { getBlankCharacterTemplate } from '../../../validators/game-systems';
import { getBlankTemplate, getCharacterTemplate } from '../index';

const SYSTEMS: GameSystem[] = [
  GameSystem.DND_5E,
  GameSystem.PATHFINDER_2E,
  GameSystem.SHADOWRUN_6E,
  GameSystem.CALL_OF_CTHULHU_7E,
];

describe('starter blank registry is the only blank JSON', () => {
  it.each(SYSTEMS)(
    'getBlankCharacterTemplate(%s) deep-equals the starter blank and is a clone',
    (system) => {
      const prismaSystem = system as unknown as PrismaGameSystem;
      const fromAlias = getBlankCharacterTemplate(system);
      const fromBlank = getBlankTemplate(prismaSystem).data;
      const fromNamed = getCharacterTemplate(prismaSystem, 'blank').data;

      expect(fromAlias).toEqual(fromBlank);
      expect(fromAlias).toEqual(fromNamed);
      expect(fromAlias).not.toBe(fromBlank);
      expect(fromAlias).not.toBe(fromNamed);
    },
  );

  it('uses the registry name literals', () => {
    expect(getBlankCharacterTemplate(GameSystem.DND_5E)).toMatchObject({
      characterName: 'New Character',
    });
    expect(getBlankCharacterTemplate(GameSystem.PATHFINDER_2E)).toMatchObject({
      characterName: 'New Character',
    });
    expect(getBlankCharacterTemplate(GameSystem.SHADOWRUN_6E)).toMatchObject({
      characterName: 'New Runner',
    });
    expect(getBlankCharacterTemplate(GameSystem.CALL_OF_CTHULHU_7E)).toMatchObject({
      investigatorName: 'Blank Investigator',
    });
  });

  it('mutating the alias does not change the shipped starter', () => {
    const prismaSystem = GameSystem.CALL_OF_CTHULHU_7E as unknown as PrismaGameSystem;
    const clone = getBlankCharacterTemplate(GameSystem.CALL_OF_CTHULHU_7E) as {
      investigatorName: string;
    };
    clone.investigatorName = 'Mutated';
    expect(getBlankTemplate(prismaSystem).data).toMatchObject({
      investigatorName: 'Blank Investigator',
    });
  });
});
