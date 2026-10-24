/**
 * Party and Session stay mounted when the drawer is closed, and trap focus
 * while it is open on a narrow viewport.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TableDrawer from '../TableDrawer';

describe('TableDrawer', () => {
  it('hides children from the accessibility tree when closed on a narrow viewport, without unmounting them', () => {
    render(
      <TableDrawer
        id="party-drawer"
        title="Party"
        side="left"
        isWide={false}
        collapsed={false}
        open={false}
        onClose={() => undefined}
      >
        <button type="button">Invite Player</button>
      </TableDrawer>
    );

    expect(screen.queryByRole('button', { name: 'Invite Player' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Party' })).toBeNull();
    expect(document.getElementById('party-drawer')?.textContent).toContain('Invite Player');
  });

  it('opens as a labelled dialog with a close control on a narrow viewport', () => {
    const onClose = vi.fn();
    render(
      <TableDrawer
        id="session-drawer"
        title="Session"
        side="right"
        isWide={false}
        collapsed={false}
        open
        onClose={onClose}
      >
        <p>Session rail</p>
      </TableDrawer>
    );

    const dialog = screen.getByRole('dialog', { name: 'Session' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Session rail')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows as a persistent rail on a wide viewport, not a dialog', () => {
    render(
      <TableDrawer
        id="session-drawer"
        title="Session"
        side="right"
        isWide
        collapsed={false}
        open={false}
        onClose={() => undefined}
      >
        <p>Session rail</p>
      </TableDrawer>
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Session rail')).toBeInTheDocument();
  });
});
