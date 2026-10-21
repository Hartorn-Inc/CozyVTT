/**
 * Which campaigns Assign to Campaign offers a character.
 *
 * A typed Campaign accepts only a Character of that same game system (a
 * Flexible Character is refused). A Campaign with no game system accepts any
 * Character. If the API still refuses, the dialog shows the server message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssignCharacterModal from '../AssignCharacterModal';
import { GameSystem, type Campaign, type CharacterSummary } from '@/types';
import { waitForDialogFocus } from '@/test/dialogFocus';

vi.mock('@/services/api', () => {
  const client = { listCampaigns: vi.fn() };
  return { api: client, default: client };
});
import { api } from '@/services/api';
const listCampaigns = api.listCampaigns as ReturnType<typeof vi.fn>;

const character = (name: string, gameSystem: GameSystem | null): CharacterSummary =>
  ({
    id: `c-${name}`,
    name,
    gameSystem,
    campaignId: null,
    tokenImageUrl: null,
  }) as unknown as CharacterSummary;

const campaign = (name: string, gameSystem: GameSystem | null): Campaign =>
  ({
    id: `camp-${name}`,
    name,
    description: null,
    gameSystem,
  }) as unknown as Campaign;

const allCampaigns = [
  campaign('Lost Mine', GameSystem.DND_5E),
  campaign('Open Table', null),
  campaign('Absalom', GameSystem.PATHFINDER_2E),
];

const offered = async (sheet: CharacterSummary) => {
  render(
    <AssignCharacterModal isOpen character={sheet} onClose={vi.fn()} onConfirm={vi.fn()} />
  );
  await waitForDialogFocus();
  await screen.findByText('Unassigned');
  return ['Lost Mine', 'Open Table', 'Absalom'].filter((name) => screen.queryByText(name) !== null);
};

beforeEach(() => {
  vi.clearAllMocks();
  listCampaigns.mockResolvedValue({ campaigns: allCampaigns });
});

describe('AssignCharacterModal', () => {
  it('offers a D&D Character a D&D Campaign and a Campaign with no game system', async () => {
    expect(await offered(character('Aria', GameSystem.DND_5E))).toEqual(['Lost Mine', 'Open Table']);
  });

  it('offers a Flexible Character only a Campaign with no game system', async () => {
    expect(await offered(character('Wanderer', null))).toEqual(['Open Table']);
  });

  it('still offers Unassign when a Flexible Character has no compatible Campaign', async () => {
    listCampaigns.mockResolvedValue({ campaigns: [campaign('Lost Mine', GameSystem.DND_5E)] });
    render(
      <AssignCharacterModal
        isOpen
        character={character('Wanderer', null)}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    await waitForDialogFocus();
    await screen.findByText('Unassigned');
    expect(screen.queryByText('Lost Mine')).toBeNull();
    expect(screen.queryByText(/same game system/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Unassign' })).toBeEnabled();
  });

  it('selects Unassign when the current Campaign is not compatible', async () => {
    const lostMine = campaign('Lost Mine', GameSystem.DND_5E);
    listCampaigns.mockResolvedValue({ campaigns: [lostMine] });
    render(
      <AssignCharacterModal
        isOpen
        character={character('Wanderer', null)}
        currentCampaign={lostMine}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    await waitForDialogFocus();
    await screen.findByText('Unassigned');
    expect(screen.getByRole('radio', { name: /Unassigned/ })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /Lost Mine/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Unassign' })).toBeEnabled();
    expect(screen.getByText(/The current Campaign is not compatible/)).toBeInTheDocument();
  });

  it('shows the server message when assign is refused', async () => {
    const refusal =
      'Cannot assign a PATHFINDER_2E character to a DND_5E campaign. Character and campaign game systems must match.';
    const onConfirm = vi.fn().mockRejectedValue({
      response: { data: { message: refusal } },
    });

    render(
      <AssignCharacterModal
        isOpen
        character={character('Aria', GameSystem.DND_5E)}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    await waitForDialogFocus();
    await screen.findByText('Lost Mine');
    await userEvent.click(screen.getByText('Lost Mine'));
    await userEvent.click(screen.getByRole('button', { name: 'Assign to Campaign' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(refusal);
  });
});
