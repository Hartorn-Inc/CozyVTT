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
});
