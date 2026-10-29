// ============================================
// useFocusTrap — Accessibility hook for modals
// ============================================
//
// Traps keyboard focus inside a container when `isOpen` is true.
// Restores focus to the previously focused element on close.
// Handles Escape key to close the modal.

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isShown(el: HTMLElement): boolean {
  if (el.closest('[inert]')) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function isTabbable(el: HTMLElement): boolean {
  return isShown(el);
}

function tabbableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(isTabbable);
}

/** Last visible dialog in tree order — the overlay currently on top. */
function isTopmostDialog(container: HTMLElement): boolean {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(isShown);
  return dialogs[dialogs.length - 1] === container;
}

/**
 * Traps keyboard focus inside a dialog container.
 *
 * @param isOpen  Whether the modal is currently open
 * @param onClose Called when the user presses Escape
 * @returns A ref to attach to the modal's root element
 */
export function useFocusTrap(isOpen: boolean, onClose?: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Keep a stable ref to the latest onClose callback.
  // This prevents the effect from re-running every time the parent re-renders
  // (which would steal focus from inputs on every keystroke).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    // Remember the element that had focus before the modal opened
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the first focusable element after the DOM has settled
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      if (document.activeElement && container.contains(document.activeElement)) return;

      const first = tabbableIn(container)[0];
      if (first) {
        first.focus();
      } else {
        // If nothing is focusable, make the container itself focusable
        container.setAttribute('tabindex', '-1');
        container.focus();
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const active = document.activeElement;
      const focusInside = active instanceof Node && (container.contains(active) || active === container);

      if (e.key === 'Escape') {
        // Nested portaled dialogs (Invite Player, discard confirm): only the
        // topmost overlay answers Escape, even if focus has not moved into it
        // yet. A lower dialog with focus still yields to the one on top.
        if (!isTopmostDialog(container)) return;
        if (onCloseRef.current) {
          e.preventDefault();
          onCloseRef.current();
        }
        return;
      }

      // Tab wrapping stays in this container. A nested portal that currently
      // has focus keeps Tab; don't yank it back.
      if (!focusInside && active !== document.body) return;

      if (e.key !== 'Tab') return;

      const focusable = tabbableIn(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: wrap from first → last
        if (active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        // Tab: wrap from last → first
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to the element that was focused before the modal opened
      previousFocusRef.current?.focus();
    };
  // onCloseRef is stable (created by useRef) — no need to include it.
   
  }, [isOpen]);

  return containerRef;
}
