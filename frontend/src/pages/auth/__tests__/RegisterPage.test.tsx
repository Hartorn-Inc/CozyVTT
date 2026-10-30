import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { AuthContextType } from '@/types/user.types';
import RegisterPage from '../RegisterPage';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/api', () => ({
  api: { getRegistrationStatus: vi.fn().mockResolvedValue({ allowRegistration: true }) },
}));

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;

function authState(overrides: Partial<AuthContextType> = {}): AuthContextType {
  return {
    user: null,
    loading: false,
    authenticated: false,
    mfaPending: false,
    mustChangePassword: false,
    serverUnreachable: false,
    backupCodesLeft: null,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    verifyMFA: vi.fn(),
    verifyMFAWithBackupCode: vi.fn(),
    cancelMFA: vi.fn(),
    setupMFA: vi.fn(),
    completeMFASetup: vi.fn(),
    disableMFA: vi.fn(),
    changePassword: vi.fn(),
    refreshUser: vi.fn(),
    adoptSession: vi.fn(),
    retryAuthCheck: vi.fn(),
    dismissBackupCodesLeft: vi.fn(),
    ...overrides,
  };
}

describe('RegisterPage display name validation', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('accepts a single-character display name and submits registration', async () => {
    const register = vi.fn().mockResolvedValue({ user: { id: 'u-1', displayName: 'Z' } });
    mockUseAuth.mockReturnValue(authState({ register }));

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Z' } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'z@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'ValidStrongPass1!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'ValidStrongPass1!' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith('z@example.com', 'ValidStrongPass1!', 'Z');
    });
    expect(screen.queryByText('Display name must be between 1 and 50 characters')).not.toBeInTheDocument();
  });

  it('rejects an empty or whitespace-only display name with validation error', async () => {
    const register = vi.fn();
    mockUseAuth.mockReturnValue(authState({ register }));

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'z@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'ValidStrongPass1!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'ValidStrongPass1!' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Display name must be between 1 and 50 characters')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });
});
