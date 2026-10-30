import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ProfilePage from '../ProfilePage';
import { profileService } from '@/services/profile.service';

const refreshUser = vi.fn(async () => undefined);
const applyUserPreferences = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: 'player@example.com',
      displayName: 'Player One',
      platformRole: 'USER',
      mfaEnabled: false,
      avatarUrl: null,
      bio: 'Ready to roll',
    },
    logout: vi.fn(),
    refreshUser,
    changePassword: vi.fn(),
  }),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    appearance: null,
    applyUserPreferences,
  }),
}));

vi.mock('@/hooks/queries', () => ({
  useServerConfigQuery: () => ({ data: undefined }),
}));

vi.mock('@/components/profile/MFASection', () => ({ default: () => null }));

vi.mock('@/services/api', () => ({
  api: {
    getUserPreferences: vi.fn(async () => ({})),
    updateUserPreferences: vi.fn(async (_id, prefs) => prefs),
  },
  default: {
    getUserPreferences: vi.fn(async () => ({})),
    updateUserPreferences: vi.fn(async (_id, prefs) => prefs),
  },
}));

vi.mock('@/services/profile.service', () => ({
  profileService: {
    updateProfile: vi.fn(),
    uploadAvatar: vi.fn(),
    removeAvatar: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));

describe('ProfilePage display name validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (profileService.updateProfile as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it('accepts a single-character display name and updates profile', async () => {
    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByLabelText(/display name/i);
    fireEvent.change(nameInput, { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(profileService.updateProfile).toHaveBeenCalledWith('user-1', {
        displayName: 'X',
        bio: 'Ready to roll',
      });
    });
    expect(screen.queryByText('Display name must be between 1 and 50 characters')).not.toBeInTheDocument();
  });

  it('rejects an empty display name with the expected error message', async () => {
    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByLabelText(/display name/i);
    fireEvent.change(nameInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    const errorEl = await screen.findByRole('alert');
    expect(errorEl).toHaveTextContent('Display name must be between 1 and 50 characters');
    expect(profileService.updateProfile).not.toHaveBeenCalled();
  });

  it('rejects display name exceeding 50 characters with the expected error message', async () => {
    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByLabelText(/display name/i);
    fireEvent.change(nameInput, { target: { value: 'A'.repeat(51) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText('Display name must be between 1 and 50 characters')).toBeInTheDocument();
    expect(profileService.updateProfile).not.toHaveBeenCalled();
  });
});
