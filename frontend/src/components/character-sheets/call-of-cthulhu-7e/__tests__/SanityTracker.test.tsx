/**
 * SanityTracker's status is a ratio of current to maximum. Issue #59 lets
 * Mythos 100 project maximum 0 while leaving current stored (e.g. 40).
 * current / 0 is Infinity, which is > 0.75, so the bar used to say Stable.
 * Maximum 0 is Breaking, whether current is still stored above it or already 0.
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
    expect(screen.getByText('Breaking')).toBeInTheDocument();
    expect(screen.queryByText('Stable')).not.toBeInTheDocument();
  });
});
