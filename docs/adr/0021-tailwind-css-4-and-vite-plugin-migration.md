# 0021. Tailwind CSS 4 and Vite Plugin Migration

Date: 2025-05-18
Status: Accepted

## Context

CozyVTT's frontend currently builds styling via Tailwind CSS v3 (`tailwindcss: 3.4.19`), executed through a PostCSS pipeline with `postcss: 8.5.31` and `autoprefixer: 10.6.1`. Additionally, `frontend/package.json` carries an `overrides` entry pinning `postcss-selector-parser: 7.1.7` under `tailwindcss` to remediate legacy transient dependency vulnerabilities.

Custom design tokens (including 16 built-in themes, palette aliases such as `parchment`, `warm-white`, `forest-green`, `moss-green`, `wood-brown`, `ink-brown`, `gold-accent`, `terracotta`, and `sepia`, WCAG-compliant `*-ink` variants, custom font stacks, box shadows, and UI animations) are defined in `frontend/tailwind.config.js` with JavaScript helper functions resolving dynamic CSS variables with alpha channels.

Tailwind CSS v4 introduces a reimagined architecture:
1. A dedicated Vite plugin (`@tailwindcss/vite`) that integrates directly with Vite's build pipeline, bypassing PostCSS and Autoprefixer entirely.
2. A CSS-first declarative configuration model using the `@theme` directive in CSS files, making `tailwind.config.js` obsolete.
3. Native modern CSS feature support (cascade layers, color-mix, custom properties) with significantly faster build and Hot Module Replacement (HMR) times.

Migrating to Tailwind CSS v4 resolves build pipeline complexity, eliminates legacy PostCSS overrides, and modernizes theme configuration while maintaining strict visual and functional parity.

## Decision

1. **Adopt `@tailwindcss/vite`**:
   - Install `@tailwindcss/vite` and upgrade `tailwindcss` to v4 in `frontend/package.json`.
   - Integrate `@tailwindcss/vite` into `frontend/vite.config.ts` plugins.
   - Uninstall `postcss` and `autoprefixer`, and delete `frontend/postcss.config.js`.

2. **Migrate to CSS-First Configuration (`@theme`)**:
   - Replace Tailwind v3 `@tailwind base; @tailwind components; @tailwind utilities;` with `@import "tailwindcss";` in `frontend/src/index.css`.
   - Declare all custom design tokens (colors, font families, radius tokens `cozy`/`cozy-lg`, custom box shadows, and keyframe animations `fade-in`, `slide-in`, `pulse-soft`) within the `@theme` block in `frontend/src/index.css`.
   - Preserve dynamic CSS variable bindings (`var(--color-...)`) with alpha support and WCAG-compliant `*-ink` contrast tokens.
   - Permanently delete `frontend/tailwind.config.js`.

3. **Sanitize Dependencies & Overrides**:
   - Remove the `overrides.tailwindcss["postcss-selector-parser"]` block from `frontend/package.json`.
   - Ensure `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities.

4. **Safeguard Visual & Theming Parity**:
   - Preserve composite utility classes (`btn-primary`, `card`, `input-cozy`, etc.) within CSS component layers.
   - Add automated Vitest integration tests verifying CSS custom property resolution across all 16 built-in CozyVTT ambiance themes and asserting computed properties of primary utility classes.

## Consequences

### Positive
- **Streamlined Build Pipeline**: Vite directly handles Tailwind compilation via Lightning CSS; PostCSS and Autoprefixer layers are eliminated.
- **Faster Developer Experience**: Reduced build times and instantaneous HMR updates during frontend development.
- **Zero Dependency Debt**: Obsolete `postcss-selector-parser` overrides are eliminated.
- **Unified CSS Source of Truth**: All theme variables, aliases, and animations live together declaratively in `src/index.css`.
- **Automated Theming Verification**: Concrete Vitest tests guarantee that theme tokens and composite classes cannot silently regress across future updates.

### Negative / Trade-offs
- **Configuration Syntax Transition**: Design tokens are no longer exposed as a JavaScript object; any tooling or tests importing `tailwind.config.js` directly must be updated or replaced.
- **Cascade & Layer Rules**: Tailwind CSS v4's CSS cascade layers require verifying that custom component utility classes (`btn-primary`, `card`, `input-cozy`) retain correct precedence over base utilities.

### Mitigations
- Automated regression test suite (`frontend/src/tests/theme-regression.test.ts`) validating variable injection for all 16 themes and computed classes.
- Strict quality gate checks executed during CI: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:run`, and `npm audit --omit=dev --audit-level=high`.
