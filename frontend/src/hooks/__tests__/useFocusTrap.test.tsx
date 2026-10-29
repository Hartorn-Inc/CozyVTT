/**
 * The trap must not cycle into inert / aria-hidden controls, and must leave
 * Escape and Tab to a nested portaled dialog.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useFocusTrap } from '../useFocusTrap';

function nextFrame(): Promise<void> {
  return act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

function Trap({
  onClose,
  nested = false,
}: {
  onClose?: () => void;
  nested?: boolean;
}) {
  const ref = useFocusTrap(true, onClose);
  return (
    <div ref={ref} role="dialog" aria-label="Outer">
      <button type="button">First</button>
      <button type="button" inert>
        Hidden inert
      </button>
      <div aria-hidden="true">
        <button type="button">Hidden aria</button>
      </div>
      <button type="button">Last</button>
      {nested ? (
        <div data-testid="portal-host">
          <div role="dialog" aria-label="Nested">
            <button type="button">Nested close</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0)
  );
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useFocusTrap', () => {
  it('skips inert and aria-hidden controls when wrapping Tab', async () => {
    render(<Trap />);
    await nextFrame();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));

    screen.getByRole('button', { name: 'Last' }).focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
  });

  it('leaves Escape to a nested dialog outside the trap container', async () => {
    const onClose = vi.fn();
    const nestedClose = vi.fn();
    function Nested() {
      const ref = useFocusTrap(true, nestedClose);
      return (
        <div ref={ref} role="dialog" aria-label="Nested">
          <button type="button">Nested close</button>
        </div>
      );
    }
    render(
      <div>
        <Trap onClose={onClose} />
        <Nested />
      </div>
    );
    await nextFrame();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(nestedClose).toHaveBeenCalled();
  });

  it('preserves focus on autoFocus elements inside the container rather than forcing first control', async () => {
    function TrapWithAutoFocus() {
      const ref = useFocusTrap(true);
      return (
        <div ref={ref} role="dialog" aria-label="Create User Modal">
          <button type="button" aria-label="Close dialog">
            Close
          </button>
          <input type="email" autoFocus data-testid="autofocus-input" placeholder="user@example.com" />
          <button type="button">Submit</button>
        </div>
      );
    }

    render(<TrapWithAutoFocus />);
    expect(document.activeElement).toBe(screen.getByTestId('autofocus-input'));

    await nextFrame();

    expect(document.activeElement).toBe(screen.getByTestId('autofocus-input'));
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Close dialog' }));
  });

  it('moves focus to the first focusable element when activeElement is outside the container', async () => {
    function TrapWithoutAutoFocus() {
      const ref = useFocusTrap(true);
      return (
        <div ref={ref} role="dialog" aria-label="Simple Dialog">
          <button type="button" aria-label="Close dialog">
            Close
          </button>
          <input type="text" data-testid="field" />
        </div>
      );
    }

    const outsideButton = document.createElement('button');
    outsideButton.textContent = 'Trigger';
    document.body.appendChild(outsideButton);
    outsideButton.focus();
    expect(document.activeElement).toBe(outsideButton);

    try {
      render(<TrapWithoutAutoFocus />);
      await nextFrame();

      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }));
    } finally {
      document.body.removeChild(outsideButton);
    }
  });

  it('focuses the container itself when no focusable elements are present', async () => {
    function EmptyTrap() {
      const ref = useFocusTrap(true);
      return (
        <div ref={ref} role="dialog" aria-label="Empty Dialog">
          <p>Static info message</p>
        </div>
      );
    }

    render(<EmptyTrap />);
    await nextFrame();

    const dialog = screen.getByRole('dialog', { name: 'Empty Dialog' });
    expect(dialog).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(dialog);
  });

  it('maintains keyboard focus trap boundaries when starting from an autoFocus element (WCAG 2.1 AA)', async () => {
    function TrapWithAutoFocus() {
      const ref = useFocusTrap(true);
      return (
        <div ref={ref} role="dialog" aria-label="Form Dialog">
          <button type="button">Close</button>
          <input type="text" autoFocus data-testid="name-field" />
          <button type="button">Save</button>
        </div>
      );
    }

    render(<TrapWithAutoFocus />);
    await nextFrame();

    const closeBtn = screen.getByRole('button', { name: 'Close' });
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    const input = screen.getByTestId('name-field');

    expect(document.activeElement).toBe(input);

    saveBtn.focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(closeBtn);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(saveBtn);
  });
});
