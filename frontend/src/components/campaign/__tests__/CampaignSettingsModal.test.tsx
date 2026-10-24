/**
 * The settings form keeps what the DM is typing when the campaign is
 * refreshed in the background.
 *
 * The page now fetches the campaign again when someone joins or leaves and
 * after a reconnect, which hands the dialog a new campaign object. The form
 * re-seeded itself from the saved values on every such object, so a
 * description being typed went back to the saved one and the dialog jumped
 * to its first tab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Campaign } from '@/types';

const refreshCampaign = vi.fn();
const beginSettingsWrite = vi.fn(() => 1);
const updateCampaign = vi.fn();
let current: Campaign;
vi.mock('@/contexts/CampaignContext', () => ({ useCampaign: () => ({ campaign: current, refreshCampaign, beginSettingsWrite, userRole: 'DM' }) }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'dm', platformRole: 'USER' } }) }));
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/services/campaign.service', () => ({
  default: { updateCampaign: (...a: unknown[]) => updateCampaign(...a) },
}));

import CampaignSettingsModal from '../CampaignSettingsModal';

const campaign = (): Campaign => ({
  id: 'c1', name: 'The Keep', description: 'Saved words', chatCooldownEnabled: false, chatCooldownSeconds: 0,
  memberships: [], userRole: 'DM', ownerId: 'dm',
}) as unknown as Campaign;

beforeEach(() => {
  refreshCampaign.mockReset();
  beginSettingsWrite.mockReset();
  beginSettingsWrite.mockReturnValue(1);
  updateCampaign.mockReset();
});

describe('CampaignSettingsModal', () => {
  it('keeps an unsaved description when the campaign is fetched again', () => {
    current = campaign();
    const { rerender } = render(<CampaignSettingsModal isOpen onClose={() => undefined} />);
    const field = screen.getByPlaceholderText('Describe your campaign…') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Half-written notes' } });

    // A roster change elsewhere: the same campaign, fetched again.
    current = campaign();
    rerender(<CampaignSettingsModal isOpen onClose={() => undefined} />);

    expect((screen.getByPlaceholderText('Describe your campaign…') as HTMLTextAreaElement).value).toBe('Half-written notes');
  });

  it('patches Context from the campaign the settings PUT returned', async () => {
    current = campaign();
    const saved = { ...campaign(), name: 'The Keep Renamed', description: 'Saved words' };
    updateCampaign.mockResolvedValue(saved);
    render(<CampaignSettingsModal isOpen onClose={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(updateCampaign).toHaveBeenCalledWith('c1', {
      name: 'The Keep',
      description: 'Saved words',
    }));
    expect(beginSettingsWrite).toHaveBeenCalled();
    expect(refreshCampaign).toHaveBeenCalledWith(saved, 1);
  });
});
