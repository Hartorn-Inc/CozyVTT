/**
 * Create-in locks Game system to a typed Campaign so Flexible is not selectable.
 * A typed Game system only offers compatible Campaigns; Flexible still lists
 * every Campaign so campaign-first inherit can set and lock Game system.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewCharacterModal from '../NewCharacterModal';
import { GameSystem, type Campaign } from '@/types';
import { getGameSystemLabel } from '@/constants/game-systems';

vi.mock('@/services/api', () => {
  const client = { listCampaigns: vi.fn() };
  return { api: client, default: client };
});
import { api } from '@/services/api';
const listCampaigns = api.listCampaigns as ReturnType<typeof vi.fn>;

const campaign = (id: string, name: string, gameSystem: GameSystem | null): Campaign =>
  ({ id, name, description: null, gameSystem }) as unknown as Campaign;

const campaigns = [
  campaign('camp-dnd', 'Lost Mine', GameSystem.DND_5E),
  campaign('camp-open', 'Open Table', null),
  campaign('camp-pf', 'Absalom', GameSystem.PATHFINDER_2E),
];

const dndCampaign = campaigns[0];

const campaignOptionNames = () =>
  ['Lost Mine', 'Open Table', 'Absalom'].filter(
    (name) => screen.queryByRole('option', { name: new RegExp(name) }) !== null
  );

beforeEach(() => {
  vi.clearAllMocks();
  listCampaigns.mockResolvedValue({ campaigns });
});

describe('NewCharacterModal', () => {
  it('locks Game system when creating into a typed Campaign, so Flexible is not selectable', async () => {
    render(<NewCharacterModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    const campaignSelect = await screen.findByLabelText(/Campaign/);
    await vi.waitFor(() => expect(screen.getByRole('option', { name: /Lost Mine/ })).toBeInTheDocument());
    await userEvent.selectOptions(campaignSelect, 'camp-dnd');

    const gameSystem = screen.getByLabelText(/Game System/);
    expect(gameSystem).toBeDisabled();
    expect(gameSystem).toHaveValue(GameSystem.DND_5E);
  });

  it('offers only compatible Campaigns after a typed Game system is selected first', async () => {
    render(<NewCharacterModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    await vi.waitFor(() => expect(screen.getByRole('option', { name: /Lost Mine/ })).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText(/Game System/), GameSystem.DND_5E);

    expect(campaignOptionNames()).toEqual(['Lost Mine', 'Open Table']);
    expect(screen.getByRole('option', { name: 'Unassigned Character' })).toBeInTheDocument();
    expect(screen.getByText(/Only compatible Campaigns are listed/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Campaign/)).toHaveAccessibleDescription(
      /Only compatible Campaigns are listed/
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      /Only compatible Campaigns are listed/
    );

    await userEvent.selectOptions(
      screen.getByLabelText(/Game System/),
      GameSystem.PATHFINDER_2E
    );
    expect(campaignOptionNames()).toEqual(['Open Table', 'Absalom']);

    await userEvent.selectOptions(screen.getByLabelText(/Game System/), '');
    expect(campaignOptionNames()).toEqual(['Lost Mine', 'Open Table', 'Absalom']);
  });

  it('still offers typed Campaigns while Game system is Flexible, so campaign-first inherit works', async () => {
    render(<NewCharacterModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    await vi.waitFor(() => expect(screen.getByRole('option', { name: /Absalom/ })).toBeInTheDocument());

    expect(campaignOptionNames()).toEqual(['Lost Mine', 'Open Table', 'Absalom']);
    expect(screen.getByLabelText(/Game System/)).toHaveValue('');
    expect(screen.queryByText(/Only compatible Campaigns are listed/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Campaign/)).toHaveAccessibleDescription(
      /Assign to a campaign now/
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows empty copy when a typed Game system has no compatible Campaigns', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [campaign('camp-pf', 'Absalom', GameSystem.PATHFINDER_2E)],
    });
    render(<NewCharacterModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    await vi.waitFor(() =>
      expect(screen.getByRole('option', { name: /Absalom/ })).toBeInTheDocument()
    );
    await userEvent.selectOptions(screen.getByLabelText(/Game System/), GameSystem.DND_5E);

    expect(screen.getByRole('option', { name: 'Unassigned Character' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Absalom/ })).not.toBeInTheDocument();

    const emptyCopy = screen.getByRole('status');
    expect(emptyCopy).toHaveTextContent(/None of your Campaigns use/);
    expect(emptyCopy).toHaveTextContent(getGameSystemLabel(GameSystem.DND_5E));
    expect(emptyCopy).toHaveTextContent(/Flexible \(No System\)/);
    expect(screen.getByLabelText(/Campaign/)).toHaveAccessibleDescription(
      /None of your Campaigns use/
    );
    expect(screen.getByLabelText(/Campaign/)).toHaveValue('');
  });

  it('keeps Game system D&D and locked after picking a D&D Campaign from the filtered list', async () => {
    render(<NewCharacterModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    await vi.waitFor(() => expect(screen.getByRole('option', { name: /Lost Mine/ })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/Game System/), GameSystem.DND_5E);
    await userEvent.selectOptions(screen.getByLabelText(/Campaign/), dndCampaign.id);

    const gameSystem = screen.getByLabelText(/Game System/);
    expect(gameSystem).toBeDisabled();
    expect(gameSystem).toHaveValue(GameSystem.DND_5E);
  });
});
