import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DnD5eCharacterEditor } from '../DnD5eCharacterEditor';
import type { Character, CharacterData } from '../../../../types';
import { dnd5eCharacter } from './dnd5eFixture';

vi.mock('@/hooks/queries', () => ({
  useServerConfigQuery: () => ({ data: undefined }),
}));

describe('DnD5eCharacterEditor - Spellcasting Backfill Lifecycle (#211)', () => {
  it('updates spell save DC smoothly when naming an ability without injecting negative offsets', async () => {
    const onSave = vi.fn<(data: CharacterData) => Promise<void>>().mockResolvedValue(undefined);
    const character = dnd5eCharacter({
      proficiencyBonus: 2,
      stats: {
        strength: { score: 10, modifier: 0 },
        dexterity: { score: 10, modifier: 0 },
        constitution: { score: 10, modifier: 0 },
        intelligence: { score: 16, modifier: 3 },
        wisdom: { score: 10, modifier: 0 },
        charisma: { score: 10, modifier: 0 },
      },
      spellcasting: {
        ability: '',
        spellSaveDC: 10,
        spellAttackBonus: 2,
        cantrips: [],
        spells: [],
        slots: Object.fromEntries(['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((l) => [l, { total: 0, expended: 0 }])),
      },
    });

    render(<DnD5eCharacterEditor character={character} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Spells/ }));

    expect(screen.getByText('10')).toBeInTheDocument();
    const dcOtherInput = screen.getByLabelText('Spell save DC other bonus') as HTMLInputElement;
    const attackOtherInput = screen.getByLabelText('Spell attack other bonus') as HTMLInputElement;
    expect(dcOtherInput.value).toBe('0');
    expect(attackOtherInput.value).toBe('0');

    const abilityInput = screen.getByLabelText('Spellcasting Ability');
    fireEvent.change(abilityInput, { target: { value: 'Intelligence' } });

    await waitFor(() => {
      expect(screen.getByText('13')).toBeInTheDocument();
      expect(screen.getByText('+5')).toBeInTheDocument();
    });

    expect(dcOtherInput.value).toBe('0');
    expect(attackOtherInput.value).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    const saved = onSave.mock.calls[0][0] as unknown as {
      spellcasting: {
        spellSaveDC: number;
        spellAttackBonus: number;
        spellSaveDCOtherBonus?: number;
        spellAttackOtherBonus?: number;
      };
    };

    expect(saved.spellcasting.spellSaveDC).toBe(13);
    expect(saved.spellcasting.spellAttackBonus).toBe(5);
    expect(saved.spellcasting.spellSaveDCOtherBonus ?? 0).not.toBeLessThan(0);
    expect(saved.spellcasting.spellAttackOtherBonus ?? 0).not.toBeLessThan(0);
  });

  it('retains backfilled legacy bonuses on initial load without re-offsetting upon stat updates', async () => {
    const onSave = vi.fn<(data: CharacterData) => Promise<void>>().mockResolvedValue(undefined);
    const character = dnd5eCharacter({
      proficiencyBonus: 2,
      stats: {
        strength: { score: 10, modifier: 0 },
        dexterity: { score: 10, modifier: 0 },
        constitution: { score: 10, modifier: 0 },
        intelligence: { score: 16, modifier: 3 },
        wisdom: { score: 10, modifier: 0 },
        charisma: { score: 10, modifier: 0 },
      },
      spellcasting: {
        ability: 'Intelligence',
        spellSaveDC: 15,
        spellAttackBonus: 7,
        cantrips: [],
        spells: [],
        slots: Object.fromEntries(['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((l) => [l, { total: 0, expended: 0 }])),
      },
    });

    render(<DnD5eCharacterEditor character={character} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Spells/ }));

    const dcOtherInput = screen.getByLabelText('Spell save DC other bonus') as HTMLInputElement;
    const attackOtherInput = screen.getByLabelText('Spell attack other bonus') as HTMLInputElement;
    expect(dcOtherInput.value).toBe('2');
    expect(attackOtherInput.value).toBe('2');
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('+7')).toBeInTheDocument();
  });
});

describe('DnD5eCharacterEditor - Container Defaults (#211)', () => {
  it('renders safely from empty raw sheet payloads without property access crashes', async () => {
    const onSave = vi.fn<(data: CharacterData) => Promise<void>>().mockResolvedValue(undefined);
    const minimalCharacter = {
      id: 'char-minimal',
      userId: 'user-1',
      name: 'Barebones',
      gameSystem: 'DND_5E',
      campaignId: null,
      tokenImageUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      data: {
        characterName: 'Barebones',
      },
    } as unknown as Character;

    render(<DnD5eCharacterEditor character={minimalCharacter} onSave={onSave} onCancel={vi.fn()} />);

    expect(screen.getByDisplayValue('Barebones')).toBeInTheDocument();
    expect(screen.getAllByText('+0').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Combat/ }));
    expect(screen.getByText('Hit Points')).toBeInTheDocument();
    expect(screen.getByText('Death Saves')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Spells/ }));
    expect(screen.getByText('Spell Save DC')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Biography/ }));
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Personality')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    const saved = onSave.mock.calls[0][0] as unknown as {
      stats: Record<string, { score: number; modifier: number }>;
      savingThrows: Record<string, { proficient: boolean; bonus: number }>;
      skills: Record<string, { proficient: boolean; bonus: number }>;
      deathSaves: { successes: number; failures: number };
    };

    expect(saved.stats.strength.score).toBe(10);
    expect(saved.stats.strength.modifier).toBe(0);
    expect(saved.savingThrows.strength.proficient).toBe(false);
    expect(saved.skills.perception.proficient).toBe(false);
    expect(saved.deathSaves).toEqual({ successes: 0, failures: 0 });
  });

  it('safely defaults missing abilities when stats block is partially undefined', async () => {
    const onSave = vi.fn<(data: CharacterData) => Promise<void>>().mockResolvedValue(undefined);
    const partialCharacter = {
      id: 'char-partial',
      userId: 'user-1',
      name: 'Partial Hero',
      gameSystem: 'DND_5E',
      campaignId: null,
      tokenImageUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      data: {
        characterName: 'Partial Hero',
        stats: {
          strength: { score: 16, modifier: 3 },
        },
      },
    } as unknown as Character;

    render(<DnD5eCharacterEditor character={partialCharacter} onSave={onSave} onCancel={vi.fn()} />);

    expect(screen.getAllByText('+3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+0').length).toBeGreaterThan(0);
  });

  it('computes spell save DC on a sheet loaded without pre-existing spellcasting without injecting negative bonus offsets', async () => {
    const onSave = vi.fn<(data: CharacterData) => Promise<void>>().mockResolvedValue(undefined);
    const character = dnd5eCharacter({
      proficiencyBonus: 2,
      stats: {
        strength: { score: 10, modifier: 0 },
        dexterity: { score: 10, modifier: 0 },
        constitution: { score: 10, modifier: 0 },
        intelligence: { score: 16, modifier: 3 },
        wisdom: { score: 10, modifier: 0 },
        charisma: { score: 10, modifier: 0 },
      },
    });
    delete (character.data as unknown as Record<string, unknown>).spellcasting;

    render(<DnD5eCharacterEditor character={character} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Spells/ }));

    const abilityInput = screen.getByLabelText('Spellcasting Ability');
    fireEvent.change(abilityInput, { target: { value: 'Intelligence' } });

    await waitFor(() => {
      expect(screen.getByText('13')).toBeInTheDocument();
      expect(screen.getByText('+5')).toBeInTheDocument();
    });

    const dcOtherInput = screen.getByLabelText('Spell save DC other bonus') as HTMLInputElement;
    const attackOtherInput = screen.getByLabelText('Spell attack other bonus') as HTMLInputElement;
    expect(dcOtherInput.value).toBe('0');
    expect(attackOtherInput.value).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    const saved = onSave.mock.calls[0][0] as unknown as {
      spellcasting: {
        spellSaveDC: number;
        spellAttackBonus: number;
        spellSaveDCOtherBonus?: number;
        spellAttackOtherBonus?: number;
      };
    };

    expect(saved.spellcasting.spellSaveDC).toBe(13);
    expect(saved.spellcasting.spellAttackBonus).toBe(5);
    expect(saved.spellcasting.spellSaveDCOtherBonus ?? 0).not.toBeLessThan(0);
    expect(saved.spellcasting.spellAttackOtherBonus ?? 0).not.toBeLessThan(0);
  });

  it('provides accessible names for cantrips, spell name inputs, remove buttons, and death saves', () => {
    const character = dnd5eCharacter({
      spellcasting: {
        ability: 'Intelligence',
        spellSaveDC: 13,
        spellAttackBonus: 5,
        cantrips: ['Fire Bolt'],
        spells: [{ level: 1, name: 'Magic Missile', prepared: true, ritual: false, concentration: false }],
        slots: Object.fromEntries(['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((l) => [l, { total: 0, expended: 0 }])),
      },
    });

    render(<DnD5eCharacterEditor character={character} onSave={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Combat/ }));
    expect(screen.getByLabelText('Death save success 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Death save success 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Death save success 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Death save failure 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Death save failure 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Death save failure 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Spells/ }));
    expect(screen.getByLabelText('Cantrips')).toBeInTheDocument();
    expect(screen.getByLabelText('Spell 1 name')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove Magic Missile')).toBeInTheDocument();
  });
});
