/**
 * SanityTracker's status is a ratio of current to maximum. Issue #59 lets
 * Mythos 100 project maximum 0 while leaving current stored (e.g. 40).
 * current / 0 is Infinity, which is > 0.75, so the bar used to say Stable.
 * Maximum 0 is Breaking, whether current is still stored above it or already 0.
 * A stored current above a positive maximum is the same over-max state: Breaking,
 * with the fill clamped to 100% and the numeric current left unclamped.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SanityTracker } from '../components/SanityTracker';

describe('SanityTracker', () => {
  it('shows Breaking, not Stable, when current 40 sits above maximum 0', () => {
    render(
      <SanityTracker current={40} starting={50} maximum={0} cthulhuMythos={100} />
    );

    const currentBox = screen.getByText('Current').parentElement;
    const maxBox = screen.getByText('Max').parentElement;
    expect(currentBox?.textContent).toContain('40');
    expect(maxBox?.textContent).toContain('0');
    expect(screen.getByText('40 / 0')).toBeInTheDocument();
    expect(screen.getByText('Breaking')).toBeInTheDocument();
    expect(screen.queryByText('Stable')).not.toBeInTheDocument();
  });

  it('shows Breaking, not Stable, when current 40 sits above maximum 1, and does not overflow the bar', () => {
    const { container } = render(
      <SanityTracker current={40} starting={50} maximum={1} />
    );

    const currentBox = screen.getByText('Current').parentElement;
    const maxBox = screen.getByText('Max').parentElement;
    expect(currentBox?.textContent).toContain('40');
    expect(maxBox?.textContent).toContain('1');
    expect(screen.getByText('40 / 1')).toBeInTheDocument();
    expect(screen.getByText('Breaking')).toBeInTheDocument();
    expect(screen.queryByText('Stable')).not.toBeInTheDocument();

    const fill = container.querySelector('.absolute.inset-y-0.left-0') as HTMLElement | null;
    expect(fill?.style.width).toBe('100%');
  });
});
