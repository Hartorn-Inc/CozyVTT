/**
 * Button loading vs busy-without-disabled.
 *
 * Default `loading` still disables. `busyKeepFocus` keeps the control in the
 * tab order while the request runs.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from '../Button';

describe('Button', () => {
  it('disables and sets aria-busy when loading', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('stays focusable with aria-busy when busyKeepFocus is set', () => {
    const onClick = vi.fn();
    render(<Button busyKeepFocus onClick={onClick}>Retry map load</Button>);
    const button = screen.getByRole('button', { name: 'Retry map load', busy: true });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button.className).toContain('opacity-50');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
