/**
 * The Call of Cthulhu read-only sheet shows projected derived values, not a
 * stale stored cache, and leaves current resources as they were stored.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CallOfCthulhu7eCharacterView } from '../CallOfCthulhu7eCharacterView';
import { COC_BLANK_SHEET, cocCharacter } from './cocFixture';

describe('projected values on the Call of Cthulhu view', () => {
  it('shows projected maximum HP 15 and leaves current at 7', () => {
    const characteristics = COC_BLANK_SHEET.characteristics as Record<string, unknown>;
    const derivedStats = COC_BLANK_SHEET.derivedStats as Record<string, unknown>;
    const character = cocCharacter({
      characteristics: {
        ...characteristics,
        CON: { regular: 70, half: 35, fifth: 14 },
        SIZ: { regular: 80, half: 40, fifth: 16 },
      },
      derivedStats: {
        ...derivedStats,
        hp: { maximum: 3, current: 7, formula: '(CON+SIZ)/10', majorWoundThreshold: 1 },
      },
    });

    render(<CallOfCthulhu7eCharacterView character={character} />);

    const box = screen.getByText('Hit Points').closest('.bg-red-50');
    expect(box?.textContent).toContain('7');
    expect(box?.textContent).toContain('/ 15');
  });

  it('does not show Stable when Mythos 100 projects sanity max 0 and current is 40', () => {
    const skills = COC_BLANK_SHEET.skills as Record<string, unknown>;
    const derivedStats = COC_BLANK_SHEET.derivedStats as Record<string, unknown>;
    const character = cocCharacter({
      skills: {
        ...skills,
        cthulhuMythos: { baseValue: 0, currentValue: 100, improvementChecked: false },
      },
      derivedStats: {
        ...derivedStats,
        sanity: { starting: 50, current: 40, maximum: 99, formula: 'POW' },
      },
    });

    render(<CallOfCthulhu7eCharacterView character={character} />);

    const currentBox = screen.getByText('Current').parentElement;
    const maxBox = screen.getByText('Max').parentElement;
    expect(currentBox?.textContent).toContain('40');
    expect(maxBox?.textContent).toContain('0');
    expect(screen.getByText('Breaking')).toBeInTheDocument();
    expect(screen.queryByText('Stable')).not.toBeInTheDocument();
  });
});
