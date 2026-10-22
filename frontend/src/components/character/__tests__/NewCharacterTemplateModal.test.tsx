/**
 * New Character Template must not offer Shadowrun 6e (ADR 0013).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import NewCharacterTemplateModal from '../NewCharacterTemplateModal';
import { GameSystem } from '@/types';
import { GAME_SYSTEM_LABELS, GAME_SYSTEM_SHORT_LABELS } from '@/constants/game-systems';

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('@/services/api', () => {
  const client = { getStarterSheet: vi.fn(), createCharacterTemplate: vi.fn() };
  return { api: client, default: client };
});

describe('NewCharacterTemplateModal', () => {
  it('offers Flexible, D&D 5e, Pathfinder 2e, and Call of Cthulhu 7e, but not Shadowrun 6e', () => {
    render(<NewCharacterTemplateModal onClose={vi.fn()} onCreated={vi.fn()} />);

    const gameSystem = screen.getByLabelText(/Game system/i);
    const options = within(gameSystem);

    expect(options.getByRole('option', { name: 'Flexible (No System)' })).toBeInTheDocument();
    expect(
      options.getByRole('option', { name: GAME_SYSTEM_LABELS[GameSystem.DND_5E] })
    ).toBeInTheDocument();
    expect(
      options.getByRole('option', { name: GAME_SYSTEM_LABELS[GameSystem.PATHFINDER_2E] })
    ).toBeInTheDocument();
    expect(
      options.getByRole('option', { name: GAME_SYSTEM_LABELS[GameSystem.CALL_OF_CTHULHU_7E] })
    ).toBeInTheDocument();

    expect(
      options.queryByRole('option', { name: GAME_SYSTEM_LABELS[GameSystem.SHADOWRUN_6E] })
    ).not.toBeInTheDocument();
    expect(options.queryByRole('option', { name: GameSystem.SHADOWRUN_6E })).not.toBeInTheDocument();
    expect(
      options.queryByRole('option', { name: GAME_SYSTEM_SHORT_LABELS[GameSystem.SHADOWRUN_6E] })
    ).not.toBeInTheDocument();
    expect(options.queryByRole('option', { name: /Shadowrun/i })).not.toBeInTheDocument();

    const values = options
      .getAllByRole('option')
      .filter((el): el is HTMLOptionElement => el instanceof HTMLOptionElement)
      .map((el) => el.value);
    expect(values).toContain(GameSystem.DND_5E);
    expect(values).toContain(GameSystem.PATHFINDER_2E);
    expect(values).toContain(GameSystem.CALL_OF_CTHULHU_7E);
    expect(values).not.toContain(GameSystem.SHADOWRUN_6E);
    expect(values).not.toContain(GAME_SYSTEM_SHORT_LABELS[GameSystem.SHADOWRUN_6E]);
  });

  it('renders a named Shadowrun option and disables Publish when saving an existing SR6 sheet as a template', () => {
    render(
      <NewCharacterTemplateModal
        onClose={vi.fn()}
        onCreated={vi.fn()}
        initial={{ name: 'Runner', gameSystem: GameSystem.SHADOWRUN_6E, data: {} }}
      />
    );

    const gameSystem = screen.getByLabelText(/Game system/i);
    expect(
      within(gameSystem).getByRole('option', {
        name: GAME_SYSTEM_LABELS[GameSystem.SHADOWRUN_6E],
      })
    ).toBeInTheDocument();
    expect(gameSystem).toHaveValue(GameSystem.SHADOWRUN_6E);

    expect(screen.getByRole('button', { name: /Publish Template/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      /cannot be published for that system until the sheet ships/i
    );
  });
});
