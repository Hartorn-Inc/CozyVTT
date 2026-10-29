import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  Pathfinder2eCharacterEditor,
  bulkToNumber,
  calculateTotalBulk,
} from '../Pathfinder2eCharacterEditor';
import type { Character, CharacterData } from '../../../../types';
import type { PF2eInventoryItem } from '../../../../types/game-systems';
import { pf2eCharacter } from './pf2eFixture';

vi.mock('@/hooks/queries', () => ({
  useServerConfigQuery: () => ({ data: undefined }),
}));

describe('Pathfinder 2e Bulk String Parsing (#216)', () => {
  describe('bulkToNumber unit calculations', () => {
    it('parses numeric values correctly', () => {
      expect(bulkToNumber(2)).toBe(2);
      expect(bulkToNumber(0)).toBe(0);
      expect(bulkToNumber(1.5)).toBe(1.5);
    });

    it('parses numeric string inputs via parseFloat', () => {
      expect(bulkToNumber('2')).toBe(2);
      expect(bulkToNumber('0')).toBe(0);
      expect(bulkToNumber('3.5')).toBe(3.5);
      expect(bulkToNumber('  4  ')).toBe(4);
      expect(bulkToNumber('0.1')).toBe(0.1);
    });

    it('parses light bulk symbols L and l as 0.1', () => {
      expect(bulkToNumber('L')).toBe(0.1);
      expect(bulkToNumber('l')).toBe(0.1);
      expect(bulkToNumber('  L  ')).toBe(0.1);
    });

    it('parses dash symbols and empty strings as 0', () => {
      expect(bulkToNumber('—')).toBe(0);
      expect(bulkToNumber('-')).toBe(0);
      expect(bulkToNumber('')).toBe(0);
      expect(bulkToNumber('   ')).toBe(0);
    });

    it('returns 0 for unparseable strings, undefined, and null', () => {
      expect(bulkToNumber('unparseable')).toBe(0);
      expect(bulkToNumber(undefined)).toBe(0);
      expect(bulkToNumber(null)).toBe(0);
    });
  });

  describe('calculateTotalBulk', () => {
    it('correctly aggregates inventory items with numeric string bulk values', () => {
      const items: PF2eInventoryItem[] = [
        {
          name: 'Greatsword',
          quantity: 2,
          bulk: '2',
          equippable: true,
          equipped: true,
          requiresAttunement: false,
          attuned: false,
          invested: false,
          value: 40,
          notes: '',
        },
        {
          name: 'Dagger',
          quantity: 3,
          bulk: 'L',
          equippable: true,
          equipped: false,
          requiresAttunement: false,
          attuned: false,
          invested: false,
          value: 4,
          notes: '',
        },
        {
          name: 'Armor',
          quantity: 1,
          bulk: 3,
          equippable: true,
          equipped: true,
          requiresAttunement: false,
          attuned: false,
          invested: false,
          value: 100,
          notes: '',
        },
        {
          name: 'Letter',
          quantity: 1,
          bulk: '—',
          equippable: false,
          equipped: false,
          requiresAttunement: false,
          attuned: false,
          invested: false,
          value: 0,
          notes: '',
        },
      ];

      // 2 * 2 + 3 * 0.1 + 1 * 3 + 1 * 0 = 4 + 0.3 + 3 = 7.3
      const total = calculateTotalBulk(items);
      expect(total).toBeCloseTo(7.3, 5);
    });
  });

  describe('Pathfinder2eCharacterEditor Bulk UI integration', () => {
    it('computes and displays bulk from typed string inputs in Inventory tab', async () => {
      const character = pf2eCharacter({
        inventory: [
          {
            name: 'Halberd',
            quantity: 1,
            bulk: '2',
            equippable: true,
            equipped: true,
            requiresAttunement: false,
            attuned: false,
            invested: false,
            value: 20,
            notes: '',
          },
          {
            name: 'Torch',
            quantity: 2,
            bulk: 'L',
            equippable: false,
            equipped: false,
            requiresAttunement: false,
            attuned: false,
            invested: false,
            value: 0.1,
            notes: '',
          },
        ],
      });

      render(
        <Pathfinder2eCharacterEditor
          character={character}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Inventory/ }));

      // Total bulk should be 2 + 2 * 0.1 = 2.2
      expect(screen.getByText('2.2')).toBeInTheDocument();

      // Changing the bulk input of the first item to '3'
      const bulkInput = screen.getByLabelText('Item 1 bulk');
      fireEvent.change(bulkInput, { target: { value: '3' } });

      await waitFor(() => {
        // Total bulk becomes 3 + 0.2 = 3.2
        expect(screen.getByText('3.2')).toBeInTheDocument();
      });
    });
  });
});

describe('Pathfinder 2e Starter Template Feat Notes Fallback (#216)', () => {
  it('displays notes in description textarea when description is absent', () => {
    const character = pf2eCharacter({
      feats: {
        ancestryAndHeritage: [],
        class: [
          {
            level: 1,
            name: 'Power Attack',
            notes: 'Deals extra weapon damage dice with strikes.',
          },
        ],
        skill: [],
        general: [],
        bonus: [],
      },
    });

    render(
      <Pathfinder2eCharacterEditor
        character={character}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Feats/ }));

    const textarea = screen.getByLabelText('Power Attack description') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Deals extra weapon damage dice with strikes.');
  });

  it('normalizes notes into description upon saving unchanged feat', async () => {
    const onSave = vi.fn<(data: CharacterData) => Promise<void>>().mockResolvedValue(undefined);
    const character = pf2eCharacter({
      feats: {
        ancestryAndHeritage: [],
        class: [
          {
            level: 1,
            name: 'Power Attack',
            notes: 'Deals extra weapon damage dice with strikes.',
          },
        ],
        skill: [],
        general: [],
        bonus: [],
      },
    });

    render(
      <Pathfinder2eCharacterEditor
        character={character}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());

    const saved = onSave.mock.calls[0][0] as unknown as {
      feats: {
        class: Array<{ name: string; description?: string; notes?: string }>;
      };
    };

    expect(saved.feats.class).toHaveLength(1);
    expect(saved.feats.class[0].name).toBe('Power Attack');
    expect(saved.feats.class[0].description).toBe('Deals extra weapon damage dice with strikes.');
    expect(saved.feats.class[0].notes).toBeUndefined();
  });

  it('updates description and normalizes on save when user edits feat notes', async () => {
    const onSave = vi.fn<(data: CharacterData) => Promise<void>>().mockResolvedValue(undefined);
    const character = pf2eCharacter({
      feats: {
        ancestryAndHeritage: [
          {
            level: 1,
            name: 'Natural Ambition',
            notes: 'Gain a 1st-level class feat.',
          },
        ],
        class: [],
        skill: [],
        general: [],
        bonus: [],
      },
    });

    render(
      <Pathfinder2eCharacterEditor
        character={character}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Feats/ }));

    const textarea = screen.getByLabelText('Natural Ambition description');
    fireEvent.change(textarea, { target: { value: 'User updated rules benefit.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());

    const saved = onSave.mock.calls[0][0] as unknown as {
      feats: {
        ancestryAndHeritage: Array<{ name: string; description?: string; notes?: string }>;
      };
    };

    expect(saved.feats.ancestryAndHeritage[0].description).toBe('User updated rules benefit.');
    expect(saved.feats.ancestryAndHeritage[0].notes).toBeUndefined();
  });
});

describe('Pathfinder 2e Empty and Partial Container Defaults (#216)', () => {
  it('renders safely from empty raw sheet payload without property access crashes', async () => {
    const onSave = vi.fn<(data: CharacterData) => Promise<void>>().mockResolvedValue(undefined);
    const minimalCharacter = {
      id: 'char-minimal',
      userId: 'user-1',
      name: 'Barebones PF2e',
      gameSystem: 'PATHFINDER_2E',
      campaignId: null,
      tokenImageUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      data: {
        characterName: 'Barebones PF2e',
      },
    } as unknown as Character;

    render(
      <Pathfinder2eCharacterEditor
        character={minimalCharacter}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue('Barebones PF2e')).toBeInTheDocument();

    // Test navigation across all tabs to ensure zero property read crashes
    fireEvent.click(screen.getByRole('button', { name: /Combat/ }));
    expect(screen.getByText('Armor Class')).toBeInTheDocument();
    expect(screen.getByText('Class DC')).toBeInTheDocument();
    expect(screen.getByText('Hit Points')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Spells/ }));
    expect(screen.getByText('No spellcasting configured')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Inventory/ }));
    expect(screen.getByText('Bulk Summary')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Feats/ }));
    expect(screen.getByText('Class Features')).toBeInTheDocument();
    expect(screen.getByText('Ancestry & Heritage Feats')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Biography/ }));
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Personality')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());

    const saved = onSave.mock.calls[0][0] as unknown as {
      attributes: Record<string, { score: number; modifier: number }>;
      savingThrows: Record<string, { proficiencyRank: string; bonus: number }>;
      armorClass: { total: number; proficiencyRank: string };
      hp: { ancestryHp: number; classHpPerLevel: number; maximum: number };
      appearance: { age: number | string; height: string };
      personality: { traits: string; ideals: string };
    };

    expect(saved.attributes.strength.score).toBe(10);
    expect(saved.attributes.strength.modifier).toBe(0);
    expect(saved.savingThrows.fortitude.proficiencyRank).toBe('untrained');
    expect(saved.armorClass.total).toBe(10);
    expect(saved.hp.ancestryHp).toBe(6);
    expect(saved.hp.classHpPerLevel).toBe(6);
    expect(saved.appearance.height).toBe('');
    expect(saved.personality.traits).toBe('');
  });

  it('safely defaults missing abilities and saves when nested blocks are partially undefined', () => {
    const partialCharacter = {
      id: 'char-partial',
      userId: 'user-1',
      name: 'Partial Hero',
      gameSystem: 'PATHFINDER_2E',
      campaignId: null,
      tokenImageUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      data: {
        characterName: 'Partial Hero',
        attributes: {
          strength: { score: 18, modifier: 4 },
        },
        savingThrows: {
          fortitude: { proficiencyRank: 'trained', itemBonus: 1, bonus: 5 },
        },
        hp: {
          current: 20,
        },
        armorClass: {
          itemBonus: 2,
        },
      },
    } as unknown as Character;

    render(
      <Pathfinder2eCharacterEditor
        character={partialCharacter}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    // Strength is +4
    expect(screen.getByText('+4')).toBeInTheDocument();
    // Other scores defaulted to +0
    expect(screen.getAllByText('+0').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Combat/ }));
    // Current HP is preserved as 20
    expect(screen.getByDisplayValue('20')).toBeInTheDocument();
  });

  it('provides accessible names for feat controls and inventory buttons', () => {
    const character = pf2eCharacter({
      inventory: [
        {
          name: 'Longsword',
          quantity: 1,
          bulk: 1,
          equippable: true,
          equipped: true,
          requiresAttunement: false,
          attuned: false,
          invested: false,
          value: 15,
          notes: '',
        },
      ],
      feats: {
        ancestryAndHeritage: [
          {
            level: 1,
            name: 'Nimble Elf',
            description: 'Your speed increases by 5 feet.',
          },
        ],
        class: [],
        skill: [],
        general: [],
        bonus: [],
      },
    });

    render(
      <Pathfinder2eCharacterEditor
        character={character}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Inventory/ }));
    expect(screen.getByLabelText('Item 1 bulk')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove Longsword')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Feats/ }));
    expect(screen.getByLabelText('Nimble Elf description')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove Nimble Elf')).toBeInTheDocument();
  });
});
