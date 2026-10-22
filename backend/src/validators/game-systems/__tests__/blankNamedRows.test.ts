/**
 * Blank required-name rows are omitted on parse, not refused.
 *
 * The editor's Add buttons create a nameless attack, item, spell, feature or
 * hit-die row. Those rows stay on the page until save; the schema drops them
 * before the name's min(1) runs, so a named sibling still stores and the blank
 * one does not.
 */

import { dnd5eCharacterDataSchema } from '../dnd5e.schema';
import { pathfinder2eCharacterDataSchema } from '../pathfinder2e.schema';
import { callOfCthulhu7eCharacterDataSchema } from '../callOfCthulhu7e.schema';
import { getBlankCharacterTemplate } from '../index';
import { GameSystem } from '../../../game-systems';

const dndBlank = () => getBlankCharacterTemplate(GameSystem.DND_5E) as Record<string, unknown>;
const pf2eBlank = () => getBlankCharacterTemplate(GameSystem.PATHFINDER_2E) as Record<string, unknown>;
const cocBlank = () => getBlankCharacterTemplate(GameSystem.CALL_OF_CTHULHU_7E) as Record<string, unknown>;

describe('D&D 5e blank required-name rows', () => {
  it('omits an unnamed attack and keeps the named one', () => {
    const parsed = dnd5eCharacterDataSchema.parse({
      ...dndBlank(),
      attacks: [
        { name: 'Sword', attackBonus: 0 },
        { name: '' },
      ],
    });
    expect(parsed.attacks).toEqual([{ name: 'Sword', attackBonus: 0 }]);
  });

  it('omits a hit-die whose class is empty and keeps a named one', () => {
    const parsed = dnd5eCharacterDataSchema.parse({
      ...dndBlank(),
      hitDice: [
        { class: 'Fighter', remaining: 1 },
        { class: '', remaining: 1 },
      ],
    });
    expect(parsed.hitDice).toEqual([{ class: 'Fighter', remaining: 1 }]);
  });

  it('omits blank inventory, spell and feature rows', () => {
    const parsed = dnd5eCharacterDataSchema.parse({
      ...dndBlank(),
      inventory: [{ name: 'Rope' }, { name: '' }],
      spellcasting: {
        spells: [
          { level: 1, name: 'Shield', prepared: false, ritual: false, concentration: false },
          { level: 1, name: '', prepared: false, ritual: false, concentration: false },
        ],
      },
      featuresAndTraits: [{ name: 'Second Wind' }, { name: '' }],
    });
    expect(parsed.inventory).toEqual([{ name: 'Rope' }]);
    expect(parsed.spellcasting?.spells).toEqual([
      { level: 1, name: 'Shield', prepared: false, ritual: false, concentration: false },
    ]);
    expect(parsed.featuresAndTraits).toEqual([{ name: 'Second Wind', description: '' }]);
  });

  it('treats whitespace-only as unnamed, and omits a nameless row that has other fields', () => {
    const parsed = dnd5eCharacterDataSchema.parse({
      ...dndBlank(),
      attacks: [
        { name: '   ' },
        { name: '', attackBonus: 4, damageRoll: '1d8', notes: 'still unnamed' },
        { name: 'Mace', attackBonus: 2 },
      ],
    });
    expect(parsed.attacks).toEqual([{ name: 'Mace', attackBonus: 2 }]);
  });

  it('still keeps a custom skill with an empty name', () => {
    const parsed = dnd5eCharacterDataSchema.parse({
      ...dndBlank(),
      customSkills: [{ name: '', ability: 'wisdom' }],
    });
    expect(parsed.customSkills).toEqual([{ name: '', ability: 'wisdom' }]);
  });
});

describe('Pathfinder 2e blank required-name rows', () => {
  it('omits an unnamed class feature and keeps the named one', () => {
    const parsed = pathfinder2eCharacterDataSchema.parse({
      ...pf2eBlank(),
      classFeatures: [{ name: 'Shield Block' }, { name: '' }],
    });
    expect(parsed.classFeatures).toEqual([{ name: 'Shield Block', description: '' }]);
  });

  it('omits an unnamed strike after the seeded name is cleared', () => {
    const parsed = pathfinder2eCharacterDataSchema.parse({
      ...pf2eBlank(),
      strikes: [{ name: 'Sword' }, { name: '' }],
    });
    expect(parsed.strikes).toEqual([{ name: 'Sword' }]);
  });
});

describe('Call of Cthulhu blank required-name rows', () => {
  it('omits an unnamed weapon and keeps the named one', () => {
    const parsed = callOfCthulhu7eCharacterDataSchema.parse({
      ...cocBlank(),
      combat: { weapons: [{ name: 'Revolver' }, { name: '' }] },
    });
    expect(parsed.combat?.weapons).toEqual([{ name: 'Revolver' }]);
  });
});
