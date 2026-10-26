/**
 * The live table's rail/drawer breakpoint is Tailwind `lg` (1024px).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWideViewport, WIDE_VIEWPORT_QUERY } from '../useWideViewport';

function installMatchMedia(matches: boolean) {
  let current = matches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      get matches() {
        return query === WIDE_VIEWPORT_QUERY ? current : false;
      },
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: (_event: string, cb: EventListener) => {
        listeners.add(cb as (event: MediaQueryListEvent) => void);
      },
      removeEventListener: (_event: string, cb: EventListener) => {
        listeners.delete(cb as (event: MediaQueryListEvent) => void);
      },
      dispatchEvent: () => false,
    }),
  });

  return {
    setMatches(next: boolean) {
      current = next;
      const event = { matches: next } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

describe('useWideViewport', () => {
  beforeEach(() => {
    installMatchMedia(false);
  });

  it('is false below 1024px', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useWideViewport());
    expect(result.current).toBe(false);
  });

  it('is true at Tailwind lg and up', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useWideViewport());
    expect(result.current).toBe(true);
  });

  it('updates when the media query changes', () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useWideViewport());
    expect(result.current).toBe(false);

    act(() => media.setMatches(true));
    expect(result.current).toBe(true);
  });
});
