import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import SetupWizardPage from '../SetupWizardPage';

vi.mock('motion/react', () => {
  const MotionDiv = (props: Record<string, unknown>) => {
    const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>;
    const plain = Object.fromEntries(
      Object.entries(rest).filter(([k]) => !/^(initial|animate|exit|transition|layout|whileHover|whileTap)$/.test(k))
    );
    return <div {...(plain as Record<string, unknown>)}>{children as never}</div>;
  };
  return {
    motion: new Proxy({}, { get: () => MotionDiv }),
    AnimatePresence: ({ children }: { children?: unknown }) => <>{children as never}</>,
  };
});

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ mascotUrl: '/mascot.png' }),
}));

const adoptSession = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ adoptSession }),
}));

const navigate = vi.fn();
vi.mock('react-router', async () => ({
  ...(await vi.importActual<typeof import('react-router')>('react-router')),
  useNavigate: () => navigate,
}));

const setupService = vi.hoisted(() => ({
  checkSetupStatus: vi.fn(),
  initializeSetup: vi.fn(),
}));
vi.mock('@/services/setup.service', () => ({ setupService, default: setupService }));

const PASSWORD = 'FirstAdmin1!Cozy';
const TOKEN = '3f9c2a7d1b8e4c6f0a5d9e2b7c1f4a8d';

async function openAccountStep() {
  render(
    <MemoryRouter>
      <SetupWizardPage />
    </MemoryRouter>
  );
  fireEvent.click(await screen.findByRole('button', { name: /next/i }));
  await screen.findByText('Create Admin Account');
}

function fillAccount(displayName: string) {
  fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: displayName } });
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'admin@example.com' } });
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: PASSWORD } });
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: PASSWORD } });
  fireEvent.change(screen.getByLabelText(/setup token/i), { target: { value: TOKEN } });
}

describe('SetupWizardPage display name validation', () => {
  beforeEach(() => {
    setupService.checkSetupStatus.mockReset().mockResolvedValue({ setupCompleted: false, hasUsers: false, needsSetup: true });
    setupService.initializeSetup.mockReset();
    adoptSession.mockReset();
    navigate.mockReset();
  });

  it('accepts a single-character display name and advances to system config', async () => {
    await openAccountStep();
    fillAccount('A');

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(await screen.findByText('System Configuration')).toBeInTheDocument();
    expect(screen.queryByText('Display name must be between 1 and 50 characters')).not.toBeInTheDocument();
  });

  it('rejects an empty or whitespace-only display name with validation error', async () => {
    await openAccountStep();
    fillAccount('   ');

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(await screen.findByText('Display name must be between 1 and 50 characters')).toBeInTheDocument();
    expect(screen.queryByText('System Configuration')).not.toBeInTheDocument();
  });
});
