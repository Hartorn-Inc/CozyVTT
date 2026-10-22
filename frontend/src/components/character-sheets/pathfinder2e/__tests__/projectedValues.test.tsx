/**
 * The Pathfinder 2e read-only sheet shows projected derived values, not a
 * stale stored cache, and leaves current resources as they were stored.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pathfinder2eCharacterView } from '../Pathfinder2eCharacterView';
import type { Character } from '../../../../types';

const attribute = { score: 10, modifier: 0 };

function characterWith(overrides: Record<string, unknown>): Character {
  return {
    id: 'char-1',
    userId: 'user-1',
    name: 'Seelah',
    gameSystem: 'PATHFINDER_2E',
    campaignId: null,
    tokenImageUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: {
      characterName: 'Seelah',
      ancestry: 'Dwarf',
      class: 'Fighter',
      level: 1,
      attributes: {
        strength: { score: 16, modifier: 3 },
        dexterity: { score: 12, modifier: 1 },
        constitution: { score: 14, modifier: 2 },
        intelligence: attribute,
        wisdom: { score: 12, modifier: 1 },
        charisma: { score: 8, modifier: -1 },
      },
      perception: { proficiencyRank: 'expert', itemBonus: 0, bonus: 6, senses: [] },
      savingThrows: {
        fortitude: { proficiencyRank: 'expert', itemBonus: 0, bonus: 7 },
        reflex: { proficiencyRank: 'expert', itemBonus: 0, bonus: 6 },
        will: { proficiencyRank: 'trained', itemBonus: 0, bonus: 4 },
      },
      skills: {},
      hp: {
        maximum: 1,
        current: 7,
        temporary: 0,
        ancestryHp: 10,
        classHpPerLevel: 10,
        resistances: [],
        immunities: [],
        weaknesses: [],
      },
      armorClass: { proficiencyRank: 'trained', itemBonus: 3, capDex: 2, armorPenalty: 0, total: 17 },
      classDC: { proficiencyRank: 'trained', keyAttribute: 'str', total: 16 },
      speed: { land: 20, other: [] },
      ...overrides,
    },
  } as unknown as Character;
}

describe('projected values on the Pathfinder 2e view', () => {
  it('shows projected maximum HP 22 and leaves current at 7', () => {
    render(<Pathfinder2eCharacterView character={characterWith({})} />);

    const maximum = screen.getByText('Maximum').parentElement;
    const current = screen.getByText('Current').parentElement;
    expect(maximum?.textContent).toContain('22');
    expect(current?.textContent).toContain('7');
  });
});
