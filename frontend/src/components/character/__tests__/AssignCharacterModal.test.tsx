/**
 * Which Campaigns assign offers for a Character.
 *
 * ADR 0015: a typed Character is offered same-system Campaigns and Campaigns
 * with no game system; a Flexible sheet is offered only Campaigns with no
 * game system. Confirming calls onConfirm; a 400 from a stale list still
 * lands in the existing alert via apiErrorMessage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssignCharacterModal from '../AssignCharacterModal';
import { GameSystem, type Campaign, type CharacterSummary } from '@/types';

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
    tokenImageUrl: null,
    userId: 'u1',
    campaignId: null,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  }) as CharacterSummary;

const campaign = (id: string, name: string, gameSystem: GameSystem | null): Campaign =>
  ({ id, name, description: null, gameSystem }) as unknown as Campaign;

const campaigns = [
  campaign('camp-dnd', 'Lost Mine', GameSystem.DND_5E),
  campaign('camp-open', 'Open Table', null),
  campaign('camp-pf', 'Absalom', GameSystem.PATHFINDER_2E),
];

function open(subject: CharacterSummary, onConfirm = vi.fn().mockResolvedValue(undefined)) {
  render(
    <AssignCharacterModal
      isOpen
      character={subject}
      onClose={vi.fn()}
      onConfirm={onConfirm}
    />
  );
  return { onConfirm };
}

const offeredNames = async () => {
  await vi.waitFor(() => expect(screen.queryByRole('radio', { name: /Unassigned/ })).not.toBeNull());
  return ['Lost Mine', 'Open Table', 'Absalom'].filter((name) => screen.queryByRole('radio', { name: new RegExp(name) }) !== null);
};

beforeEach(() => {
  vi.clearAllMocks();
  listCampaigns.mockResolvedValue({ campaigns });
});

describe('AssignCharacterModal', () => {
  it('offers a D&D Character a D&D Campaign and a Campaign with no game system, not Pathfinder', async () => {
    open(character('Dwarf', GameSystem.DND_5E));
    expect(await offeredNames()).toEqual(['Lost Mine', 'Open Table']);
  });

  it('offers a Flexible Character only Campaigns with no game system', async () => {
    open(character('Wanderer', null));
    expect(await offeredNames()).toEqual(['Open Table']);
  });

  it('calls onConfirm with the selected Campaign', async () => {
    const { onConfirm } = open(character('Dwarf', GameSystem.DND_5E));
    await offeredNames();

    await userEvent.click(screen.getByRole('radio', { name: /Lost Mine/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Assign to Campaign' }));

    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledWith('c-Dwarf', 'camp-dnd'));
  });

  it('shows an API error string in the alert', async () => {
    const onConfirm = vi.fn().mockRejectedValue({
      response: { data: { message: 'Cannot assign a DND_5E character to a PATHFINDER_2E campaign. Character and campaign game systems must match.' } },
    });
    open(character('Dwarf', GameSystem.DND_5E), onConfirm);
    await offeredNames();

    await userEvent.click(screen.getByRole('radio', { name: /Lost Mine/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Assign to Campaign' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot assign a DND_5E character to a PATHFINDER_2E campaign. Character and campaign game systems must match.'
    );
  });

  it('selects Unassign when the current Campaign is not compatible', async () => {
    const lostMine = campaign('camp-dnd', 'Lost Mine', GameSystem.DND_5E);
    listCampaigns.mockResolvedValue({ campaigns: [lostMine] });
    const wanderer = character('Wanderer', null);

    render(
      <AssignCharacterModal
        isOpen
        character={wanderer}
        currentCampaign={lostMine}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const unassign = await screen.findByRole('radio', { name: /Unassigned/ });
    expect(unassign).toBeChecked();
    expect(screen.queryByRole('radio', { name: /Lost Mine/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Unassign' })).toBeEnabled();
  });

  it('lets a Flexible Character already in a typed Campaign unassign when nothing compatible is offered', async () => {
    const dnd = campaign('camp-dnd', 'Lost Mine', GameSystem.DND_5E);
    listCampaigns.mockResolvedValue({ campaigns: [dnd] });
    const wanderer = character('Wanderer', null);
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <AssignCharacterModal
        isOpen
        character={wanderer}
        currentCampaign={dnd}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const unassign = await screen.findByRole('radio', { name: /Unassigned/ });
    expect(unassign).toBeChecked();
    expect(screen.queryByRole('radio', { name: /Lost Mine/ })).toBeNull();
    expect(screen.getByText(/You can unassign this Character now/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Unassign' }));
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledWith('c-Wanderer', null));
  });
});
