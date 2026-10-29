/**
 * Tests clipboard copying in AdminPage with LAN HTTP fallback.
 *
 * Over plain HTTP in LAN environments, navigator.clipboard is undefined.
 * AdminPage uses copyText from utils/clipboard, falling back to
 * document.execCommand('copy'), and displays toast feedback on success and failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import AdminPage from '../AdminPage';
import { waitForDialogFocus } from '@/test/dialogFocus';
import * as clipboardModule from '@/utils/clipboard';

const mockShowToast = vi.fn();
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-1', displayName: 'Root', platformRole: 'ADMIN' } }),
}));
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ refreshAppearance: vi.fn() }),
}));

const adminService = vi.hoisted(() => ({
  getStats: vi.fn(),
  getUsers: vi.fn(),
  getConfig: vi.fn(),
  createUser: vi.fn(),
  resetUserPassword: vi.fn(),
}));
vi.mock('@/services/admin.service', () => ({ adminService }));
vi.mock('@/services/api', () => ({ api: {}, default: {} }));

const execCommand = vi.fn();

function setClipboard(clipboard: { writeText: (text: string) => Promise<void> } | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

async function openCreateUserModal() {
  render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>
  );
  await userEvent.click(screen.getByRole('tab', { name: /Users/i }));
  await userEvent.click(await screen.findByRole('button', { name: /Create User/i }));
  return waitForDialogFocus(await screen.findByRole('dialog', { name: 'Create User' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  execCommand.mockReset();
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
  adminService.getStats.mockResolvedValue({ assetBreakdown: [], totalStorageBytes: 0 });
  adminService.getUsers.mockResolvedValue([
    {
      id: 'user-2',
      email: 'alice@example.com',
      displayName: 'Alice',
      platformRole: 'USER',
      mfaEnabled: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      isApproved: true,
    },
  ]);
  adminService.getConfig.mockResolvedValue({ smtp: { configured: false } });
  adminService.createUser.mockResolvedValue({
    user: { id: 'u-9', email: 'new@example.test', displayName: 'New', platformRole: 'USER' },
    emailSent: false,
    temporaryPassword: 'NEW-USER-TEMP-1234',
  });
  adminService.resetUserPassword.mockResolvedValue('RESET-TEMP-5678');
});

afterEach(() => {
  setClipboard(undefined);
  vi.restoreAllMocks();
});

describe('AdminPage clipboard copying in Create User flow', () => {
  it('invokes copyText and displays success toast when copying temporary password', async () => {
    const copySpy = vi.spyOn(clipboardModule, 'copyText').mockResolvedValue(true);
    await openCreateUserModal();

    await userEvent.type(screen.getByLabelText(/Email/i), 'new@example.test');
    const createButtons = screen.getAllByRole('button', { name: 'Create User' });
    await userEvent.click(createButtons[createButtons.length - 1]);
    await screen.findByText('NEW-USER-TEMP-1234');

    const copyButton = screen.getByRole('button', { name: 'Copy' });
    await userEvent.click(copyButton);

    expect(copySpy).toHaveBeenCalledWith('NEW-USER-TEMP-1234');
    expect(mockShowToast).toHaveBeenCalledWith('Password copied to clipboard', 'success');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('falls back to document.execCommand when navigator.clipboard is undefined over plain HTTP', async () => {
    setClipboard(undefined);
    execCommand.mockReturnValue(true);
    const copySpy = vi.spyOn(clipboardModule, 'copyText');

    await openCreateUserModal();
    await userEvent.type(screen.getByLabelText(/Email/i), 'new@example.test');
    const createButtons = screen.getAllByRole('button', { name: 'Create User' });
    await userEvent.click(createButtons[createButtons.length - 1]);
    await screen.findByText('NEW-USER-TEMP-1234');

    const copyButton = screen.getByRole('button', { name: 'Copy' });
    await userEvent.click(copyButton);

    expect(copySpy).toHaveBeenCalledWith('NEW-USER-TEMP-1234');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(mockShowToast).toHaveBeenCalledWith('Password copied to clipboard', 'success');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('surfaces error toast when clipboard copying fails over plain HTTP', async () => {
    setClipboard(undefined);
    execCommand.mockReturnValue(false);
    const copySpy = vi.spyOn(clipboardModule, 'copyText');

    await openCreateUserModal();
    await userEvent.type(screen.getByLabelText(/Email/i), 'new@example.test');
    const createButtons = screen.getAllByRole('button', { name: 'Create User' });
    await userEvent.click(createButtons[createButtons.length - 1]);
    await screen.findByText('NEW-USER-TEMP-1234');

    const copyButton = screen.getByRole('button', { name: 'Copy' });
    await userEvent.click(copyButton);

    expect(copySpy).toHaveBeenCalledWith('NEW-USER-TEMP-1234');
    expect(mockShowToast).toHaveBeenCalledWith('Failed to copy password. Please select and copy manually.', 'error');
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});

describe('AdminPage clipboard copying in User Reset Password flow', () => {
  it('invokes copyText with the temporary password and shows feedback on success and failure', async () => {
    const copySpy = vi.spyOn(clipboardModule, 'copyText');
    setClipboard(undefined);
    execCommand.mockReturnValue(true);

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole('tab', { name: /Users/i }));
    await screen.findByText('Alice');

    const pwdButton = screen.getByRole('button', { name: /Pwd/i });
    await userEvent.click(pwdButton);

    const generateButton = await screen.findByRole('button', { name: /Generate Temporary Password/i });
    await userEvent.click(generateButton);

    await screen.findByText('RESET-TEMP-5678');
    const copyBtn = screen.getByRole('button', { name: 'Copy' });
    await userEvent.click(copyBtn);

    expect(copySpy).toHaveBeenCalledWith('RESET-TEMP-5678');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(mockShowToast).toHaveBeenCalledWith('Password copied to clipboard', 'success');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('displays error toast when copying fails during password reset', async () => {
    setClipboard(undefined);
    execCommand.mockReturnValue(false);

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole('tab', { name: /Users/i }));
    await screen.findByText('Alice');

    const pwdButton = screen.getByRole('button', { name: /Pwd/i });
    await userEvent.click(pwdButton);

    const generateButton = await screen.findByRole('button', { name: /Generate Temporary Password/i });
    await userEvent.click(generateButton);

    await screen.findByText('RESET-TEMP-5678');
    const copyBtn = screen.getByRole('button', { name: 'Copy' });
    await userEvent.click(copyBtn);

    expect(mockShowToast).toHaveBeenCalledWith('Failed to copy password. Please select and copy manually.', 'error');
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
  });
});
