import { describe, it, expect } from '@jest/globals';
import {
  armorClassSchema,
  classDCSchema,
  spellDCSchema,
  spellcastingEntrySchema,
} from '../game-systems/pathfinder2e.schema';
import { validateCharacterData } from '../game-systems';
import { GameSystem } from '../../game-systems';

const baseAttributes = {
  strength: { score: 10, modifier: 0 },
  dexterity: { score: 8, modifier: -1 },
  constitution: { score: 10, modifier: 0 },
  intelligence: { score: 10, modifier: 0 },
  wisdom: { score: 10, modifier: 0 },
  charisma: { score: 10, modifier: 0 },
};

const validBaseSheet = {
  themeColor: 'Classic Blue',
  characterName: 'Valeros',
  class: 'Fighter',
  level: 1,
  ancestry: 'Human',
  heritage: 'Skilled Heritage',
  attributes: baseAttributes,
};

describe('Pathfinder 2e Schema Bounds (#209)', () => {
  describe('armorClassSchema', () => {
    it('accepts AC of 9 (e.g., untrained with Dexterity -1)', () => {
      const valid = armorClassSchema.safeParse({
        total: 9,
        proficiencyRank: 'untrained',
        capDex: null,
        itemBonus: 0,
        armorPenalty: 0,
      });
      expect(valid.success).toBe(true);
    });

    it('accepts AC of 0', () => {
      const valid = armorClassSchema.safeParse({
        total: 0,
        proficiencyRank: 'untrained',
        capDex: null,
        itemBonus: 0,
        armorPenalty: 0,
      });
      expect(valid.success).toBe(true);
    });

    it('rejects negative AC values strictly less than 0', () => {
      const invalid = armorClassSchema.safeParse({
        total: -1,
        proficiencyRank: 'untrained',
        capDex: null,
        itemBonus: 0,
        armorPenalty: 0,
      });
      expect(invalid.success).toBe(false);
    });

    it('exposes a min(0) bound on shape.total', () => {
      expect(armorClassSchema.shape.total.safeParse(9).success).toBe(true);
      expect(armorClassSchema.shape.total.safeParse(0).success).toBe(true);
      expect(armorClassSchema.shape.total.safeParse(-1).success).toBe(false);
    });
  });

  describe('classDCSchema', () => {
    it('accepts class DC of 9', () => {
      const valid = classDCSchema.safeParse({
        total: 9,
        keyAttribute: 'strength',
        proficiencyRank: 'untrained',
      });
      expect(valid.success).toBe(true);
    });

    it('accepts class DC of 0', () => {
      const valid = classDCSchema.safeParse({
        total: 0,
        keyAttribute: 'strength',
        proficiencyRank: 'untrained',
      });
      expect(valid.success).toBe(true);
    });

    it('rejects negative class DC values strictly less than 0', () => {
      const invalid = classDCSchema.safeParse({
        total: -1,
        keyAttribute: 'strength',
        proficiencyRank: 'untrained',
      });
      expect(invalid.success).toBe(false);
    });

    it('exposes a min(0) bound on shape.total', () => {
      expect(classDCSchema.shape.total.safeParse(9).success).toBe(true);
      expect(classDCSchema.shape.total.safeParse(0).success).toBe(true);
      expect(classDCSchema.shape.total.safeParse(-1).success).toBe(false);
    });
  });

  describe('spellDCSchema and spellcastingEntrySchema', () => {
    it('accepts spell DC of 9', () => {
      const valid = spellDCSchema.safeParse({
        proficiencyRank: 'untrained',
        itemBonus: 0,
        dc: 9,
      });
      expect(valid.success).toBe(true);
    });

    it('accepts spell DC of 0', () => {
      const valid = spellDCSchema.safeParse({
        proficiencyRank: 'untrained',
        itemBonus: 0,
        dc: 0,
      });
      expect(valid.success).toBe(true);
    });

    it('rejects negative spell DC strictly less than 0', () => {
      const invalid = spellDCSchema.safeParse({
        proficiencyRank: 'untrained',
        itemBonus: 0,
        dc: -1,
      });
      expect(invalid.success).toBe(false);
    });

    it('exposes min(0) bound on spellDCSchema.shape.dc', () => {
      expect(spellDCSchema.shape.dc.safeParse(9).success).toBe(true);
      expect(spellDCSchema.shape.dc.safeParse(0).success).toBe(true);
      expect(spellDCSchema.shape.dc.safeParse(-1).success).toBe(false);
    });

    it('exposes min(0) bound on spellcastingEntrySchema.shape.dc.shape.total', () => {
      expect(spellcastingEntrySchema.shape.dc.shape.total.safeParse(9).success).toBe(true);
      expect(spellcastingEntrySchema.shape.dc.shape.total.safeParse(0).success).toBe(true);
      expect(spellcastingEntrySchema.shape.dc.shape.total.safeParse(-1).success).toBe(false);
    });
  });

  describe('Full Character Sheet Validation', () => {
    it('validates a character with AC 9 and Class DC 9', () => {
      const sheet = {
        ...validBaseSheet,
        armorClass: {
          total: 9,
          proficiencyRank: 'untrained',
          capDex: null,
          itemBonus: 0,
          armorPenalty: 0,
        },
        classDC: {
          total: 9,
          keyAttribute: 'strength',
          proficiencyRank: 'untrained',
        },
        spellcasting: {
          spellDC: {
            proficiencyRank: 'untrained',
            itemBonus: 0,
            dc: 9,
          },
        },
      };

      const result = validateCharacterData(GameSystem.PATHFINDER_2E, sheet);
      expect(result.success).toBe(true);
    });

    it('rejects a character with negative AC', () => {
      const sheet = {
        ...validBaseSheet,
        armorClass: {
          total: -1,
          proficiencyRank: 'untrained',
          capDex: null,
          itemBonus: 0,
          armorPenalty: 0,
        },
      };

      const result = validateCharacterData(GameSystem.PATHFINDER_2E, sheet);
      expect(result.success).toBe(false);
    });

    it('rejects a character with negative Class DC', () => {
      const sheet = {
        ...validBaseSheet,
        classDC: {
          total: -1,
          keyAttribute: 'strength',
          proficiencyRank: 'untrained',
        },
      };

      const result = validateCharacterData(GameSystem.PATHFINDER_2E, sheet);
      expect(result.success).toBe(false);
    });

    it('rejects a character with negative Spell DC', () => {
      const sheet = {
        ...validBaseSheet,
        spellcasting: {
          spellDC: {
            proficiencyRank: 'untrained',
            itemBonus: 0,
            dc: -1,
          },
        },
      };

      const result = validateCharacterData(GameSystem.PATHFINDER_2E, sheet);
      expect(result.success).toBe(false);
    });
  });
});
