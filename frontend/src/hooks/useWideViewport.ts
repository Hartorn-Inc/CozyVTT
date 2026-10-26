// ============================================
// useWideViewport — Tailwind `lg` (1024px) and up
//
// The live table uses one mounted tree at every width. Rails vs drawers are
// CSS, so the breakpoint has to be the same question in JS (`matchMedia`) as
// in Tailwind (`lg:`). Mirrors useReducedMotion: subscribe to the media query
// rather than reading window.innerWidth on resize.
// ============================================

import { useEffect, useState } from 'react';

/** Tailwind `lg` — persistent tool rails; below this, Party/Session are drawers. */
export const WIDE_VIEWPORT_QUERY = '(min-width: 1024px)';

export function useWideViewport(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(WIDE_VIEWPORT_QUERY).matches === true
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(WIDE_VIEWPORT_QUERY);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    // Sync once in case the viewport changed between render and effect.
    setWide(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return wide;
}
