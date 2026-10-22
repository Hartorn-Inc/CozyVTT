/**
 * Create-in locks Game system to a typed Campaign so Flexible is not selectable.
 * A typed Game system only offers compatible Campaigns; Flexible still lists
 * every Campaign so campaign-first inherit can set and lock Game system.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewCharacterModal from '../NewCharacterModal';
import { GameSystem, type Campaign } from '@/types';
import {
  GAME_SYSTEM_LABELS,
  GAME_SYSTEM_SHORT_LABELS,
  getGameSystemLabel,
} from '@/constants/game-systems';

vi.mock('@/services/api', () => {
  const client = {
    listCampaigns: vi.fn(),
    getStarterSheet: vi.fn(),
    createCharacter: vi.fn(),
  };
  return { api: client, default: client };
});
import { api } from '@/services/api';
const listCampaigns = api.listCampaigns as ReturnType<typeof vi.fn>;
const getStarterSheet = api.getStarterSheet as ReturnType<typeof vi.fn>;
const createCharacter = api.createCharacter as ReturnType<typeof vi.fn>;

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
  getStarterSheet.mockResolvedValue({
    name: 'Blank D&D 5e Character',
    description: 'A blank character sheet for D&D 5th Edition',
    gameSystem: GameSystem.DND_5E,
    data: { characterName: 'New Character' },
  });
  createCharacter.mockResolvedValue({ character: { id: 'char-1', name: 'Aria' } });
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

  it('offers Flexible, D&D 5e, Pathfinder 2e, and Call of Cthulhu 7e, but not Shadowrun 6e', () => {
    render(<NewCharacterModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    const gameSystem = screen.getByLabelText(/Game System/);
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

  it('does not offer a Shadowrun Campaign on the Flexible path, so Game system stays unmatched-free', async () => {
    listCampaigns.mockResolvedValue({
      campaigns: [
        campaign('camp-dnd', 'Lost Mine', GameSystem.DND_5E),
        campaign('camp-sr6', 'Shadows of Seattle', GameSystem.SHADOWRUN_6E),
        campaign('camp-open', 'Open Table', null),
      ],
    });
    render(<NewCharacterModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    await vi.waitFor(() =>
      expect(screen.getByRole('option', { name: /Lost Mine/ })).toBeInTheDocument()
    );

    expect(
      screen.queryByRole('option', { name: /Shadows of Seattle/ })
    ).not.toBeInTheDocument();

    const gameSystem = screen.getByLabelText(/Game System/);
    expect(gameSystem).toHaveValue('');
    expect(gameSystem).not.toHaveValue(GameSystem.SHADOWRUN_6E);

    const options = within(gameSystem);
    expect(
      options.queryByRole('option', { name: GAME_SYSTEM_LABELS[GameSystem.SHADOWRUN_6E] })
    ).not.toBeInTheDocument();
    expect(options.queryByRole('option', { name: GameSystem.SHADOWRUN_6E })).not.toBeInTheDocument();
    expect(options.queryByRole('option', { name: /Shadowrun/i })).not.toBeInTheDocument();

    const values = options
      .getAllByRole('option')
      .filter((el): el is HTMLOptionElement => el instanceof HTMLOptionElement)
      .map((el) => el.value);
    expect(values).not.toContain(GameSystem.SHADOWRUN_6E);
  });

  it('renders a named Shadowrun option and disables submit when Game system is preselected as unchoosable', async () => {
    render(
      <NewCharacterModal
        isOpen
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        preselectedGameSystem={GameSystem.SHADOWRUN_6E}
      />
    );

    const gameSystem = screen.getByLabelText(/Game System/);
    expect(
      within(gameSystem).getByRole('option', {
        name: GAME_SYSTEM_LABELS[GameSystem.SHADOWRUN_6E],
      })
    ).toBeInTheDocument();
    expect(gameSystem).toHaveValue(GameSystem.SHADOWRUN_6E);

    await userEvent.type(screen.getByLabelText(/Character Name/), 'Runner');

    expect(screen.getByRole('button', { name: /Create Character/ })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Create & Publish as Template/ })
    ).toBeDisabled();
    expect(screen.getByText(/New Characters cannot be created/i)).toBeInTheDocument();
    expect(screen.queryByText(/Street Samurai/)).not.toBeInTheDocument();
  });

  it('loads the blank starter from the starter-template API, including blank', async () => {
    render(<NewCharacterModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    await vi.waitFor(() =>
      expect(screen.getByRole('option', { name: /Lost Mine/ })).toBeInTheDocument()
    );
    await userEvent.selectOptions(screen.getByLabelText(/Game System/), GameSystem.DND_5E);
    await userEvent.type(screen.getByLabelText(/Character Name/), 'Aria');
    await userEvent.click(screen.getByRole('button', { name: /Create Character/ }));

    await vi.waitFor(() => expect(getStarterSheet).toHaveBeenCalled());
    expect(getStarterSheet).toHaveBeenCalledWith(GameSystem.DND_5E, 'blank');
    expect(createCharacter).toHaveBeenCalled();
  });
});
