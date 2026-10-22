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
});
