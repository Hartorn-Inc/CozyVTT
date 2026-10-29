import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DnD5eCharacterEditor, DND5E_CUSTOM_SKILLS_MAX, DND5E_OTHER_DAMAGE_ROLLS_MAX } from '../DnD5eCharacterEditor';
import { dnd5eCharacter } from './dnd5eFixture';

vi.mock('@/hooks/queries', () => ({
  useServerConfigQuery: () => ({ data: undefined }),
}));

const customSkill = (name: string) => ({
  name,
  ability: 'dexterity' as const,
  proficient: true,
  expertise: false,
});

const damageRoll = (label: string) => ({
  label,
  damageRoll: '1d6',
  damageType: 'fire',
});

const attackWithDamageRolls = (name: string, count: number) => ({
  name,
  attackBonus: 0,
  damageRoll: '1d8',
  damageType: 'slashing',
  range: 5,
  properties: [],
  notes: '',
  additionalDamage: Array.from({ length: count }, (_, i) => damageRoll(`Roll ${i + 1}`)),
});

describe('DnD5eCharacterEditor - List Limits (#213)', () => {
  describe('Custom Skills Limit (30)', () => {
    it('enables + Add Skill button when customSkills count is below 30', () => {
      const skills = Array.from({ length: 29 }, (_, i) => customSkill(`Skill ${i + 1}`));
      render(<DnD5eCharacterEditor character={dnd5eCharacter({ customSkills: skills })} onSave={vi.fn()} onCancel={vi.fn()} />);

      const addButton = screen.getByRole('button', { name: '+ Add Skill' });
      expect(addButton).toBeEnabled();
      expect(screen.queryByText(/a sheet holds at most 30 entries here/)).not.toBeInTheDocument();
    });

    it('disables + Add Skill button and displays accessible limit note when reaching 30', () => {
      const skills = Array.from({ length: 29 }, (_, i) => customSkill(`Skill ${i + 1}`));
      render(<DnD5eCharacterEditor character={dnd5eCharacter({ customSkills: skills })} onSave={vi.fn()} onCancel={vi.fn()} />);

      const addButton = screen.getByRole('button', { name: '+ Add Skill' });
      fireEvent.click(addButton);

      expect(addButton).toBeDisabled();
      const limitNote = screen.getByRole('status');
      expect(limitNote).toHaveTextContent(/a sheet holds at most 30 entries here/);
      expect(addButton).toHaveAttribute('aria-describedby', limitNote.id);
      expect(addButton).toHaveAttribute('title', expect.stringContaining('30'));
    });

    it('prevents adding past 30 custom skills through the UI', () => {
      const skills = Array.from({ length: DND5E_CUSTOM_SKILLS_MAX }, (_, i) => customSkill(`Skill ${i + 1}`));
      render(<DnD5eCharacterEditor character={dnd5eCharacter({ customSkills: skills })} onSave={vi.fn()} onCancel={vi.fn()} />);

      const addButton = screen.getByRole('button', { name: '+ Add Skill' });
      expect(addButton).toBeDisabled();
      fireEvent.click(addButton);

      const removeButtons = screen.getAllByRole('button', { name: /Remove Skill/ });
      expect(removeButtons).toHaveLength(30);
    });

    it('re-enables + Add Skill button when an item is removed from a full list', () => {
      const skills = Array.from({ length: DND5E_CUSTOM_SKILLS_MAX }, (_, i) => customSkill(`Skill ${i + 1}`));
      render(<DnD5eCharacterEditor character={dnd5eCharacter({ customSkills: skills })} onSave={vi.fn()} onCancel={vi.fn()} />);

      const addButton = screen.getByRole('button', { name: '+ Add Skill' });
      expect(addButton).toBeDisabled();

      const removeFirst = screen.getByRole('button', { name: 'Remove Skill 1' });
      fireEvent.click(removeFirst);

      expect(addButton).toBeEnabled();
      expect(screen.queryByText(/a sheet holds at most 30 entries here/)).not.toBeInTheDocument();
    });
  });

  describe('Attack Additional Damage Rolls Limit (10 per attack)', () => {
    it('enables + Add Damage Roll button when additional damage count is below 10', () => {
      const character = dnd5eCharacter({
        attacks: [attackWithDamageRolls('Longsword', 9)],
      });
      render(<DnD5eCharacterEditor character={character} onSave={vi.fn()} onCancel={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Combat/ }));

      const addButton = screen.getByRole('button', { name: '+ Add Damage Roll' });
      expect(addButton).toBeEnabled();
      expect(screen.queryByText(/a sheet holds at most 10 entries here/)).not.toBeInTheDocument();
    });

    it('disables + Add Damage Roll button and displays accessible limit note when reaching 10', () => {
      const character = dnd5eCharacter({
        attacks: [attackWithDamageRolls('Longsword', 9)],
      });
      render(<DnD5eCharacterEditor character={character} onSave={vi.fn()} onCancel={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Combat/ }));

      const addButton = screen.getByRole('button', { name: '+ Add Damage Roll' });
      fireEvent.click(addButton);

      expect(addButton).toBeDisabled();
      const limitNote = screen.getByRole('status');
      expect(limitNote).toHaveTextContent(/a sheet holds at most 10 entries here/);
      expect(addButton).toHaveAttribute('aria-describedby', limitNote.id);
      expect(addButton).toHaveAttribute('title', expect.stringContaining('10'));
    });

    it('prevents adding past 10 additional damage rolls on an attack', () => {
      const character = dnd5eCharacter({
        attacks: [attackWithDamageRolls('Longsword', DND5E_OTHER_DAMAGE_ROLLS_MAX)],
      });
      render(<DnD5eCharacterEditor character={character} onSave={vi.fn()} onCancel={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Combat/ }));

      const addButton = screen.getByRole('button', { name: '+ Add Damage Roll' });
      expect(addButton).toBeDisabled();
      fireEvent.click(addButton);

      const removeButtons = screen.getAllByRole('button', { name: /Remove damage roll/ });
      expect(removeButtons).toHaveLength(10);
    });

    it('re-enables + Add Damage Roll button when a damage roll is removed', () => {
      const character = dnd5eCharacter({
        attacks: [attackWithDamageRolls('Longsword', DND5E_OTHER_DAMAGE_ROLLS_MAX)],
      });
      render(<DnD5eCharacterEditor character={character} onSave={vi.fn()} onCancel={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Combat/ }));

      const addButton = screen.getByRole('button', { name: '+ Add Damage Roll' });
      expect(addButton).toBeDisabled();

      const removeFirst = screen.getByRole('button', { name: 'Remove damage roll 1' });
      fireEvent.click(removeFirst);

      expect(addButton).toBeEnabled();
      expect(screen.queryByText(/a sheet holds at most 10 entries here/)).not.toBeInTheDocument();
    });

    it('tracks damage roll limits independently per attack', () => {
      const character = dnd5eCharacter({
        attacks: [
          attackWithDamageRolls('Full Weapon', DND5E_OTHER_DAMAGE_ROLLS_MAX),
          attackWithDamageRolls('Roomy Weapon', 2),
        ],
      });
      render(<DnD5eCharacterEditor character={character} onSave={vi.fn()} onCancel={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Combat/ }));

      const addButtons = screen.getAllByRole('button', { name: '+ Add Damage Roll' });
      expect(addButtons[0]).toBeDisabled();
      expect(addButtons[1]).toBeEnabled();
    });
  });
});
