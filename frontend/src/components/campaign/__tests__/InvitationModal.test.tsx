/**
 * Which characters the invitation offers to bring along.
 *
 * The same rule the server applies when the invitation is accepted, and when
 * a character is assigned from the Characters page: a typed Campaign accepts
 * only a Character of that same game system (a Flexible Character is refused).
 * A Campaign with no game system accepts any Character. Existing mismatches
 * still load; this dialog only offers what the server will accept.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import InvitationModal from '../InvitationModal';
import { CampaignStatus, GameSystem, InvitationStatus, type CampaignInvitation, type Character } from '@/types';

vi.mock('@/services/api', () => {
  const client = { listCharacters: vi.fn(), acceptInvitation: vi.fn(), declineInvitation: vi.fn() };
  return { api: client, default: client };
});
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

  it('offers a campaign with no game system every unassigned character', async () => {
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
