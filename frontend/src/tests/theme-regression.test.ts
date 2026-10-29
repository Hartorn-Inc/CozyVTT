import { describe, it, expect, beforeEach } from 'vitest';

import { PRESET_THEMES, applyThemeColors, deriveReadableTokens } from '../themes';
import indexCss from '../index.css?raw';

const RGB_CHANNELS_PATTERN = /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/;

function isValidRgbChannels(value: string): boolean {
  if (!RGB_CHANNELS_PATTERN.test(value.trim())) {
    return false;
  }
  const channels = value.trim().split(/\s+/).map(Number);
  return channels.length === 3 && channels.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
}

describe('Theme and Composite Styling Regression Test Suite', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
  });

  describe('Preset Themes & CSS Custom Property Bindings', () => {
    it('contains exactly 16 preset themes', () => {
      expect(PRESET_THEMES).toHaveLength(16);
    });

    const requiredThemeVariableNames = [
      '--color-brand-rgb',
      '--color-brand-dark-rgb',
      '--color-accent-rgb',
      '--color-accent-hover-rgb',
      '--color-accent-text-rgb',
      '--color-bg-base-rgb',
      '--color-bg-surface-rgb',
      '--color-bg-surface-light-rgb',
      '--color-bg-surface-dark-rgb',
      '--color-ink-rgb',
      '--color-ink-secondary-rgb',
      '--color-ink-muted-rgb',
      '--color-paper-rgb',
      '--color-danger-rgb',
      '--color-spirit-rgb',
      '--color-brand-ink-rgb',
      '--color-accent-ink-rgb',
      '--color-spirit-ink-rgb',
      '--color-danger-ink-rgb',
      '--color-success-rgb',
      '--color-success-ink-rgb',
      '--color-warning-rgb',
      '--color-warning-ink-rgb',
      '--color-info-rgb',
      '--color-info-ink-rgb',
    ];

    describe.each(PRESET_THEMES)('Theme: $name ($id)', (theme) => {
      it('applies valid RGB channel values for all required theme custom properties', () => {
        applyThemeColors(theme.colors);
        const root = document.documentElement;

        for (const varName of requiredThemeVariableNames) {
          const value = root.style.getPropertyValue(varName);
          expect(value, `Expected ${varName} to be set for theme ${theme.name}`).not.toBe('');
          expect(
            isValidRgbChannels(value),
            `Expected ${varName} to have valid RGB channels (0-255) for theme ${theme.name}, received "${value}"`
          ).toBe(true);
        }
      });

      it('derives readable WCAG ink and status tokens properly', () => {
        const derived = deriveReadableTokens(theme.colors);

        expect(derived['--color-ink-muted']).toBeDefined();
        expect(isValidRgbChannels(derived['--color-ink-muted'])).toBe(true);

        expect(derived['--color-brand-ink']).toBeDefined();
        expect(isValidRgbChannels(derived['--color-brand-ink'])).toBe(true);

        expect(derived['--color-accent-ink']).toBeDefined();
        expect(isValidRgbChannels(derived['--color-accent-ink'])).toBe(true);

        expect(derived['--color-spirit-ink']).toBeDefined();
        expect(isValidRgbChannels(derived['--color-spirit-ink'])).toBe(true);

        expect(derived['--color-danger-ink']).toBeDefined();
        expect(isValidRgbChannels(derived['--color-danger-ink'])).toBe(true);

        expect(derived['--color-accent-text']).toBeDefined();
        expect(isValidRgbChannels(derived['--color-accent-text'])).toBe(true);
      });
    });
  });

  describe('Composite Component Classes and Core Tailwind Utility Classes', () => {
    it('declares .btn-primary with expected styles and no missing rules', () => {
      expect(indexCss).toContain('.btn-primary');
      const btnPrimaryMatch = indexCss.match(/\.btn-primary\s*\{[^}]*\}/s);
      expect(btnPrimaryMatch).not.toBeNull();
      const btnPrimaryContent = btnPrimaryMatch ? btnPrimaryMatch[0] : '';

      expect(btnPrimaryContent).toContain('bg-accent');
      expect(btnPrimaryContent).toContain('text-accent-text');
      expect(btnPrimaryContent).toContain('rounded-cozy');
      expect(btnPrimaryContent).toContain('hover:bg-accent-hover');
    });

    it('declares .card-cozy with expected styles and no missing rules', () => {
      expect(indexCss).toContain('.card-cozy');
      const cardCozyMatch = indexCss.match(/\.card-cozy\s*\{[^}]*\}/s);
      expect(cardCozyMatch).not.toBeNull();
      const cardCozyContent = cardCozyMatch ? cardCozyMatch[0] : '';

      expect(cardCozyContent).toContain('backdrop-blur-cozy');
      expect(cardCozyContent).toContain('rounded-cozy');
      expect(cardCozyContent).toContain('shadow-lg');
      expect(cardCozyContent).toContain('hover:shadow-xl');
    });

    it('declares .input-cozy with expected styles and no missing rules', () => {
      expect(indexCss).toContain('.input-cozy');
      const inputCozyMatch = indexCss.match(/\.input-cozy\s*\{[^}]*\}/s);
      expect(inputCozyMatch).not.toBeNull();
      const inputCozyContent = inputCozyMatch ? inputCozyMatch[0] : '';

      expect(inputCozyContent).toContain('rounded-cozy');
      expect(inputCozyContent).toContain('bg-paper/80');
      expect(inputCozyContent).toContain('text-ink');
      expect(inputCozyContent).toContain('placeholder:text-ink-muted');
    });

    it('declares key components and utility layers without syntax corruption', () => {
      expect(indexCss).toContain('@layer base');
      expect(indexCss).toContain('@layer components');
      expect(indexCss).toContain('@layer utilities');
      expect(indexCss).toContain('.glass-panel');
      expect(indexCss).toContain('.btn-secondary');
      expect(indexCss).toContain('.btn-danger');
      expect(indexCss).toContain('.alert-danger');
      expect(indexCss).toContain('.badge-neutral');
      expect(indexCss).toContain('.input-cozy-number');
    });
  });

  describe('Legacy Tailwind CSS 3 Configuration Removal', () => {
    it('verifies tailwind.config.* and postcss.config.* are absent via Vite import glob', () => {
      const rootConfigs = import.meta.glob(['/tailwind.config.*', '/postcss.config.*']);
      expect(Object.keys(rootConfigs)).toEqual([]);
    });
  });
});
