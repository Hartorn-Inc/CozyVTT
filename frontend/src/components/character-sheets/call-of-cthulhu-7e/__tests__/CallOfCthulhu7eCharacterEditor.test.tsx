import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CallOfCthulhu7eCharacterEditor } from '../CallOfCthulhu7eCharacterEditor';
import { cocCharacter } from './cocFixture';
import { GameSystem, type Character, type CharacterData } from '../../../../types';

vi.mock('@/services/api', () => ({
  api: {
    uploadAsset: vi.fn(),
  },
}));

describe('CallOfCthulhu7eCharacterEditor - POW 100 Sanity Cap and Container Defaults (#219)', () => {
  describe('POW 100 Sanity Cap', () => {
    it('caps starting Sanity at 99 and current Sanity at maxSanity when POW is 100 with no prior Sanity', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const onCancel = vi.fn();

      const character = cocCharacter({
        characteristics: {
          STR: { regular: 50, half: 25, fifth: 10 },
          CON: { regular: 50, half: 25, fifth: 10 },
          SIZ: { regular: 50, half: 25, fifth: 10 },
          DEX: { regular: 50, half: 25, fifth: 10 },
          APP: { regular: 50, half: 25, fifth: 10 },
          INT: { regular: 50, half: 25, fifth: 10 },
          POW: { regular: 100, half: 50, fifth: 20 },
          EDU: { regular: 50, half: 25, fifth: 10 },
        },
        derivedStats: undefined,
      });

      render(
        <CallOfCthulhu7eCharacterEditor
          character={character}
          onSave={onSave}
          onCancel={onCancel}
        />
      );

      const saveButton = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      const savedData = onSave.mock.calls[0][0] as unknown as {
        derivedStats: {
          sanity: { starting: number; current: number; maximum: number };
        };
      };
      expect(savedData.derivedStats.sanity.starting).toBe(99);
      expect(savedData.derivedStats.sanity.current).toBe(99);
      expect(savedData.derivedStats.sanity.maximum).toBe(99);
    });

    it('caps current Sanity at maxSanity (99 - Mythos) when POW is 100 and Mythos is positive', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const onCancel = vi.fn();

      const character = cocCharacter({
        characteristics: {
          STR: { regular: 50, half: 25, fifth: 10 },
          CON: { regular: 50, half: 25, fifth: 10 },
          SIZ: { regular: 50, half: 25, fifth: 10 },
          DEX: { regular: 50, half: 25, fifth: 10 },
          APP: { regular: 50, half: 25, fifth: 10 },
          INT: { regular: 50, half: 25, fifth: 10 },
          POW: { regular: 100, half: 50, fifth: 20 },
          EDU: { regular: 50, half: 25, fifth: 10 },
        },
        skills: {
          cthulhuMythos: { baseValue: 0, currentValue: 15, improvementChecked: false },
        },
        derivedStats: undefined,
      });

      render(
        <CallOfCthulhu7eCharacterEditor
          character={character}
          onSave={onSave}
          onCancel={onCancel}
        />
      );

      const saveButton = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      const savedData = onSave.mock.calls[0][0] as unknown as {
        derivedStats: {
          sanity: { starting: number; current: number; maximum: number };
        };
      };
      expect(savedData.derivedStats.sanity.starting).toBe(99);
      expect(savedData.derivedStats.sanity.maximum).toBe(84);
      expect(savedData.derivedStats.sanity.current).toBe(84);
      expect(savedData.derivedStats.sanity.current).toBeLessThanOrEqual(savedData.derivedStats.sanity.maximum);
    });

    it('caps starting Sanity at 99 when changing POW to 100 interactively in the editor', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const onCancel = vi.fn();

      const character = cocCharacter({
        characteristics: {
          STR: { regular: 50, half: 25, fifth: 10 },
          CON: { regular: 50, half: 25, fifth: 10 },
          SIZ: { regular: 50, half: 25, fifth: 10 },
          DEX: { regular: 50, half: 25, fifth: 10 },
          APP: { regular: 50, half: 25, fifth: 10 },
          INT: { regular: 50, half: 25, fifth: 10 },
          POW: { regular: 50, half: 25, fifth: 10 },
          EDU: { regular: 50, half: 25, fifth: 10 },
        },
        derivedStats: undefined,
      });

      render(
        <CallOfCthulhu7eCharacterEditor
          character={character}
          onSave={onSave}
          onCancel={onCancel}
        />
      );

      const powInput = screen.getByLabelText('POW regular value');
      fireEvent.change(powInput, { target: { value: '100' } });

      const saveButton = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      const savedData = onSave.mock.calls[0][0] as unknown as {
        derivedStats: {
          sanity: { starting: number; current: number };
        };
        characteristics: {
          POW: { regular: number };
        };
      };
      expect(savedData.derivedStats.sanity.starting).toBeLessThanOrEqual(99);
      expect(savedData.derivedStats.sanity.current).toBeLessThanOrEqual(99);
      expect(savedData.characteristics.POW.regular).toBe(100);
    });
  });

  describe('Container Defaults', () => {
    it('safely hydrates with missing or empty characteristics without runtime errors', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const onCancel = vi.fn();

      const sparseCharacter: Character = {
        id: 'char-sparse',
        userId: 'user-1',
        name: 'Sparse Investigator',
        gameSystem: GameSystem.CALL_OF_CTHULHU_7E,
        campaignId: null,
        tokenImageUrl: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        data: {
          investigatorName: 'Sparse Investigator',
          occupation: 'Private Eye',
          era: '1920s',
        } as unknown as CharacterData,
      };

      render(
        <CallOfCthulhu7eCharacterEditor
          character={sparseCharacter}
          onSave={onSave}
          onCancel={onCancel}
        />
      );

      expect(screen.getByDisplayValue('Sparse Investigator')).toBeInTheDocument();
      expect(screen.getByText('Characteristics')).toBeInTheDocument();
      expect(screen.getByText('HP Max:')).toBeInTheDocument();
      expect(screen.getByText('MP Max:')).toBeInTheDocument();
      expect(screen.getByText('Max SAN:')).toBeInTheDocument();

      const saveButton = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      const savedData = onSave.mock.calls[0][0] as unknown as {
        characteristics: Record<string, { regular: number; half: number; fifth: number }>;
        derivedStats: {
          hp: { maximum: number };
          magicPoints: { maximum: number };
          sanity: { starting: number };
        };
      };
      expect(savedData.characteristics.STR).toEqual({ regular: 50, half: 25, fifth: 10 });
      expect(savedData.characteristics.CON).toEqual({ regular: 50, half: 25, fifth: 10 });
      expect(savedData.characteristics.SIZ).toEqual({ regular: 50, half: 25, fifth: 10 });
      expect(savedData.characteristics.DEX).toEqual({ regular: 50, half: 25, fifth: 10 });
      expect(savedData.characteristics.APP).toEqual({ regular: 50, half: 25, fifth: 10 });
      expect(savedData.characteristics.INT).toEqual({ regular: 50, half: 25, fifth: 10 });
      expect(savedData.characteristics.POW).toEqual({ regular: 50, half: 25, fifth: 10 });
      expect(savedData.characteristics.EDU).toEqual({ regular: 50, half: 25, fifth: 10 });
      expect(savedData.derivedStats.hp.maximum).toBeGreaterThan(0);
      expect(savedData.derivedStats.magicPoints.maximum).toBeGreaterThan(0);
      expect(savedData.derivedStats.sanity.starting).toBeLessThanOrEqual(99);
    });

    it('populates default appearance and wealth structure without undefined property errors', () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const onCancel = vi.fn();

      const characterWithEmptyContainers: Character = {
        id: 'char-empty',
        userId: 'user-1',
        name: 'Empty Containers',
        gameSystem: GameSystem.CALL_OF_CTHULHU_7E,
        campaignId: null,
        tokenImageUrl: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        data: {
          investigatorName: 'Empty Containers',
          occupation: 'Antiquarian',
          era: '1920s',
          characteristics: {},
          derivedStats: {},
          appearance: {},
          wealth: {},
          backstory: {},
          conditions: {},
        } as unknown as CharacterData,
      };

      expect(() => {
        render(
          <CallOfCthulhu7eCharacterEditor
            character={characterWithEmptyContainers}
            onSave={onSave}
            onCancel={onCancel}
          />
        );
      }).not.toThrow();
    });
  });

  describe('Accessibility Attributes', () => {
    it('provides accessible names for Current HP, Current MP, and Luck fields', () => {
      const character = cocCharacter();
      render(
        <CallOfCthulhu7eCharacterEditor
          character={character}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByLabelText('Current HP')).toBeInTheDocument();
      expect(screen.getByLabelText('Current MP')).toBeInTheDocument();
      expect(screen.getByLabelText('Luck Score')).toBeInTheDocument();
    });

    it('provides accessible names for appearance fields in backstory tab', () => {
      const character = cocCharacter();
      render(
        <CallOfCthulhu7eCharacterEditor
          character={character}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /backstory/i }));

      expect(screen.getByLabelText('Age')).toBeInTheDocument();
      expect(screen.getByLabelText('Height')).toBeInTheDocument();
      expect(screen.getByLabelText('Weight')).toBeInTheDocument();
      expect(screen.getByLabelText('Eyes')).toBeInTheDocument();
      expect(screen.getByLabelText('Hair')).toBeInTheDocument();
      expect(screen.getByLabelText('Skin')).toBeInTheDocument();
    });

    it('renders save failure in an alert role container with assertive live announcement', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('Save failed'));
      const character = cocCharacter();
      render(
        <CallOfCthulhu7eCharacterEditor
          character={character}
          onSave={onSave}
          onCancel={vi.fn()}
        />
      );

      const saveButton = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveButton);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
      expect(alert).toHaveTextContent('Failed to save character. Please try again.');
    });
  });
});
