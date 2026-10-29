import { describe, it, expect } from 'vitest';
import indexCss from '../index.css?raw';

describe('Tailwind CSS 4 index.css configuration', () => {
  it('uses @import "tailwindcss"; and removes legacy directives', () => {
    expect(indexCss).toMatch(/@import\s+['"]tailwindcss['"];/);
    expect(indexCss).not.toMatch(/@tailwind/);
    expect(indexCss).not.toMatch(/@config/);
  });

  it('declares semantic color tokens in @theme', () => {
    const themeBlock = /@theme\s*\{([\s\S]*?)\}/.exec(indexCss)?.[1] ?? '';
    expect(themeBlock).not.toBe('');

    const requiredSemanticColors = [
      '--color-brand',
      '--color-brand-dark',
      '--color-accent',
      '--color-accent-hover',
      '--color-accent-text',
      '--color-canvas',
      '--color-surface',
      '--color-surface-light',
      '--color-surface-dark',
      '--color-ink',
      '--color-ink-secondary',
      '--color-ink-muted',
      '--color-paper',
      '--color-danger',
      '--color-spirit',
    ];

    for (const token of requiredSemanticColors) {
      expect(themeBlock).toContain(token);
    }
  });

  it('declares readable WCAG tokens in @theme', () => {
    const themeBlock = /@theme\s*\{([\s\S]*?)\}/.exec(indexCss)?.[1] ?? '';
    const requiredWcagTokens = [
      '--color-brand-ink',
      '--color-accent-ink',
      '--color-spirit-ink',
      '--color-danger-ink',
    ];

    for (const token of requiredWcagTokens) {
      expect(themeBlock).toContain(token);
    }
  });

  it('declares semantic state colors in @theme', () => {
    const themeBlock = /@theme\s*\{([\s\S]*?)\}/.exec(indexCss)?.[1] ?? '';
    const requiredStateColors = [
      '--color-success',
      '--color-success-ink',
      '--color-warning',
      '--color-warning-ink',
      '--color-info',
      '--color-info-ink',
    ];

    for (const token of requiredStateColors) {
      expect(themeBlock).toContain(token);
    }
  });

  it('declares historical aliases in @theme', () => {
    const themeBlock = /@theme\s*\{([\s\S]*?)\}/.exec(indexCss)?.[1] ?? '';
    const requiredAliases = [
      '--color-moss-green',
      '--color-forest-shadow',
      '--color-warm-amber',
      '--color-sunset-orange',
      '--color-soft-cream',
      '--color-parchment',
      '--color-parchment-light',
      '--color-parchment-dark',
      '--color-charcoal',
      '--color-warm-gray',
      '--color-stone-gray',
      '--color-paper-white',
      '--color-spirit-red',
      '--color-spirit-purple',
    ];

    for (const token of requiredAliases) {
      expect(themeBlock).toContain(token);
    }
  });

  it('declares static sepia palette 100 to 900 in @theme', () => {
    const themeBlock = /@theme\s*\{([\s\S]*?)\}/.exec(indexCss)?.[1] ?? '';
    const sepiaEntries: Record<string, string> = {
      '--color-sepia-100': '#F5EBD9',
      '--color-sepia-200': '#E8D5B7',
      '--color-sepia-300': '#D4B896',
      '--color-sepia-400': '#C19A6B',
      '--color-sepia-500': '#A67C52',
      '--color-sepia-600': '#8B6939',
      '--color-sepia-700': '#6B5230',
      '--color-sepia-800': '#4A3C28',
      '--color-sepia-900': '#2E2419',
    };

    for (const [token, value] of Object.entries(sepiaEntries)) {
      expect(themeBlock).toMatch(new RegExp(`${token}:\\s*${value}`, 'i'));
    }
  });

  it('declares typography, border radii, blur filters, and custom animations in @theme', () => {
    const themeBlock = /@theme\s*\{([\s\S]*?)\}/.exec(indexCss)?.[1] ?? '';
    expect(themeBlock).toContain('--font-heading: var(--font-heading);');
    expect(themeBlock).toContain('--font-body: var(--font-body);');
    expect(themeBlock).toContain('--font-mono: var(--font-mono);');
    expect(themeBlock).toContain('--radius-cozy: 12px;');
    expect(themeBlock).toContain('--radius-cozy-lg: 20px;');
    expect(themeBlock).toContain('--blur-cozy: 10px;');
    expect(themeBlock).toContain('--animate-fade-in: fadeIn 0.3s ease-in-out;');
    expect(themeBlock).toContain('--animate-slide-in: slideIn 0.4s ease-out;');
    expect(themeBlock).toContain('--animate-pulse-soft: pulseSoft 2s ease-in-out infinite;');
  });

  it('declares keyframe rules for custom animations', () => {
    expect(indexCss).toMatch(/@keyframes\s+fadeIn\s*\{/);
    expect(indexCss).toMatch(/@keyframes\s+slideIn\s*\{/);
    expect(indexCss).toMatch(/@keyframes\s+pulseSoft\s*\{/);
  });

  it('preserves composite utility classes and accessible focus states', () => {
    const expectedClasses = [
      '.glass-panel',
      '.btn-primary',
      '.btn-secondary',
      '.btn-danger',
      '.input-cozy',
      '.card-cozy',
      '.alert-danger',
      '.alert-success',
      '.alert-warning',
      '.alert-info',
      '.badge-danger',
      '.badge-success',
      '.badge-warning',
      '.badge-neutral',
    ];

    for (const cls of expectedClasses) {
      expect(indexCss).toContain(cls);
    }

    expect(indexCss).toContain('[data-separator]:focus-visible');
  });
});
