/**
 * Create-in locks Game system to a typed Campaign so Flexible is not selectable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewCharacterModal from '../NewCharacterModal';
import { GameSystem, type Campaign } from '@/types';

vi.mock('@/services/api', () => {
  const client = { listCampaigns: vi.fn() };
  return { api: client, default: client };
});
import { api } from '@/services/api';
const listCampaigns = api.listCampaigns as ReturnType<typeof vi.fn>;

const dndCampaign = {
  id: 'camp-dnd',
  name: 'Lost Mine',
  gameSystem: GameSystem.DND_5E,
} as unknown as Campaign;

beforeEach(() => {
  vi.clearAllMocks();
  listCampaigns.mockResolvedValue({ campaigns: [dndCampaign] });
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
});
