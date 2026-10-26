import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider, useToast } from '@/contexts/ToastContext';
import ToastContainer from '../ToastContainer';

// Simulate trigger components representing different domains
function MapActions() {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast('Goblin Sniper is already standing there.', 'info')}>
      Trigger Map Collision
    </button>
  );
}

function RosterActions() {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast('Failed to load character for editing', 'error')}>
      Trigger Roster Error
    </button>
  );
}

function SessionActions() {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast('Session paused by DM', 'warning')}>
      Trigger Session Warning
    </button>
  );
}

function InvitationActions() {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast('Campaign invitation expired', 'error')}>
      Trigger Invitation Error
    </button>
  );
}

function VibeActions() {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast('Failed to stream atmosphere track', 'error')}>
      Trigger Vibe Error
    </button>
  );
}

function LiveTableHarness() {
  return (
    <ToastProvider>
      {/* Global container stays viewport-fixed outside any canvas transform */}
      <ToastContainer />
      {/* Canvas container with pan transform applied */}
      <div
        data-testid="panned-canvas-container"
        style={{ transform: 'translate3d(-400px, -250px, 0px) scale(1.5)' }}
      >
        <MapActions />
      </div>
      <div data-testid="sidebar-drawer">
        <RosterActions />
        <SessionActions />
        <InvitationActions />
        <VibeActions />
      </div>
    </ToastProvider>
  );
}

describe('Toast Stack System', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stacks errors from map, roster, session, invitation, and vibe into the same global toast stack', async () => {
    render(<LiveTableHarness />);

    act(() => {
      screen.getByRole('button', { name: 'Trigger Map Collision' }).click();
      screen.getByRole('button', { name: 'Trigger Roster Error' }).click();
      screen.getByRole('button', { name: 'Trigger Session Warning' }).click();
      screen.getByRole('button', { name: 'Trigger Invitation Error' }).click();
      screen.getByRole('button', { name: 'Trigger Vibe Error' }).click();
    });

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(5);

    expect(screen.getByText('Goblin Sniper is already standing there.')).toBeInTheDocument();
    expect(screen.getByText('Failed to load character for editing')).toBeInTheDocument();
    expect(screen.getByText('Session paused by DM')).toBeInTheDocument();
    expect(screen.getByText('Campaign invitation expired')).toBeInTheDocument();
    expect(screen.getByText('Failed to stream atmosphere track')).toBeInTheDocument();
  });

  it('stays viewport-fixed outside canvas transform when the map is panned', () => {
    render(<LiveTableHarness />);

    const container = screen.getByLabelText('Notifications');
    const canvas = screen.getByTestId('panned-canvas-container');

    // Verify ToastContainer is outside the panned canvas element
    expect(canvas.contains(container)).toBe(false);
    expect(container.className).toContain('fixed');
    expect(container.className).toContain('top-4');
    expect(container.className).toContain('right-4');
  });

  it('keeps toast duration on the stack and does not restart older toast timers when a new toast is added', () => {
    render(<LiveTableHarness />);

    act(() => {
      screen.getByRole('button', { name: 'Trigger Map Collision' }).click();
    });
    expect(screen.getByText('Goblin Sniper is already standing there.')).toBeInTheDocument();

    // Advance 3000ms
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Add a second toast while first has 2000ms left
    act(() => {
      screen.getByRole('button', { name: 'Trigger Roster Error' }).click();
    });
    expect(screen.getByText('Failed to load character for editing')).toBeInTheDocument();

    // Advance 2000ms: first toast reaches 5000ms and dismisses, second toast has 3000ms left
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Goblin Sniper is already standing there.')).not.toBeInTheDocument();
    expect(screen.getByText('Failed to load character for editing')).toBeInTheDocument();

    // Advance 3000ms: second toast reaches 5000ms and dismisses
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('Failed to load character for editing')).not.toBeInTheDocument();
  });

  it('confirms the legacy local single-toast hook has been removed from components/Toast', async () => {
    const ToastModule = await import('@/components/Toast');
    expect('useToast' in ToastModule).toBe(false);
  });
});
