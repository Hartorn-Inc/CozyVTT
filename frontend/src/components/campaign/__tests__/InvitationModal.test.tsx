/**
 * Which characters the invitation offers to bring along.
 *
 * ADR 0015: a typed Campaign offers only unassigned Characters of that Game
 * system (a Flexible sheet is refused); a Campaign with no game system offers
 * any unassigned Character. The same rule the server applies when the
 * invitation is accepted, and when a Character is assigned from the Characters
 * page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import InvitationModal from '../InvitationModal';
import { CampaignStatus, GameSystem, InvitationStatus, type CampaignInvitation, type Character } from '@/types';

vi.mock('@/services/api', () => {
  const client = { listCharacters: vi.fn(), acceptInvitation: vi.fn(), declineInvitation: vi.fn() };
  return { api: client, default: client };
});

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
import { api } from '@/services/api';
const listCharacters = api.listCharacters as ReturnType<typeof vi.fn>;

const character = (name: string, gameSystem: GameSystem | null, campaignId: string | null = null) =>
  ({ id: `c-${name}`, name, gameSystem, campaignId, tokenImageUrl: null }) as unknown as Character;

const invitationTo = (gameSystem: GameSystem | null): CampaignInvitation => ({
  id: 'inv-1',
  campaignId: 'camp-1',
  userId: 'u1',
  status: InvitationStatus.PENDING,
  createdAt: '2026-09-28T00:00:00.000Z',
  expiresAt: null,
  campaign: { id: 'camp-1', name: 'The Table', description: null, gameSystem, status: CampaignStatus.ACTIVE },
});

const offered = async (gameSystem: GameSystem | null) => {
  render(<InvitationModal invitation={invitationTo(gameSystem)} onClose={vi.fn()} onAccept={vi.fn()} onDecline={vi.fn()} />);
  await screen.findByText('Select Characters (Optional)');
  await vi.waitFor(() => expect(screen.queryByText('Loading characters...')).toBeNull());
  return ['Dwarf', 'Wanderer', 'Oracle', 'Taken'].filter((name) => screen.queryByText(name) !== null);
};

beforeEach(() => {
  vi.clearAllMocks();
  listCharacters.mockResolvedValue({
    characters: [
      character('Dwarf', GameSystem.DND_5E),
      character('Wanderer', null),
      character('Oracle', GameSystem.PATHFINDER_2E),
      character('Taken', GameSystem.DND_5E, 'elsewhere'),
    ],
  });
});

const openInvitation = async (gameSystem: GameSystem | null) => {
  render(
    <InvitationModal
      invitation={invitationTo(gameSystem)}
      onClose={vi.fn()}
      onAccept={vi.fn()}
      onDecline={vi.fn()}
    />
  );
  await screen.findByText('Select Characters (Optional)');
  await vi.waitFor(() => expect(screen.queryByText('Loading characters...')).toBeNull());
};

describe('InvitationModal', () => {
  it('offers a D&D 5e campaign only unassigned D&D 5e characters', async () => {
    expect(await offered(GameSystem.DND_5E)).toEqual(['Dwarf']);
  });

  it('offers a Campaign with no game system every unassigned Character', async () => {
    expect(await offered(null)).toEqual(['Dwarf', 'Wanderer', 'Oracle']);
  });

  it('explains a typed campaign empty list and still lets the player Accept', async () => {
    listCharacters.mockResolvedValue({
      characters: [character('Wanderer', null), character('Oracle', GameSystem.PATHFINDER_2E)],
    });
    await openInvitation(GameSystem.DND_5E);
    expect(screen.queryByText('Wanderer')).toBeNull();
    expect(screen.queryByText('Oracle')).toBeNull();
    expect(
      screen.getByText(/Only unassigned D&D 5th Edition Characters are offered, not Flexible sheets/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept Invitation' })).toBeEnabled();
  });

  it('shows a load error instead of an empty compatible list', async () => {
    listCharacters.mockRejectedValue({
      response: { data: { message: 'Characters could not be loaded.' } },
    });
    await openInvitation(GameSystem.DND_5E);
    expect(screen.getByRole('alert')).toHaveTextContent('Characters could not be loaded.');
    expect(screen.queryByText(/No compatible characters available/)).toBeNull();
    expect(screen.queryByText(/not Flexible sheets/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Accept Invitation' })).toBeEnabled();
  });
});
