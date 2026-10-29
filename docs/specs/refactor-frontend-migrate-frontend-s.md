# Specification: Frontend Styling Migration from Tailwind CSS 3 to Tailwind CSS 4

## 1. Executive Summary & Problem Statement

The CozyVTT frontend styling stack currently depends on Tailwind CSS v3 (`tailwindcss: 3.4.19`) orchestrated through an intermediate PostCSS pipeline (`postcss: 8.5.31`, `autoprefixer: 10.6.1`) configured in `frontend/postcss.config.js`. Due to transient vulnerability constraints in the Tailwind v3 dependency tree, `frontend/package.json` contains a pinned override for `postcss-selector-parser: 7.1.7`.

All custom theme tokens—including CozyVTT's 16 ambiance themes, semantic color aliases (`parchment`, `warm-white`, `forest-green`, `moss-green`, `wood-brown`, `ink-brown`, `gold-accent`, `terracotta`, `sepia`), WCAG-compliant high-contrast `*-ink` variants, typography, borders, shadows, and animations—are declared via JavaScript exports in `frontend/tailwind.config.js`.

This specification defines the migration of `frontend/` to **Tailwind CSS 4**:
1. Adopting the official native `@tailwindcss/vite` plugin and dismantling the legacy PostCSS/Autoprefixer pipeline.
2. Converting all design tokens and dynamic variable configurations to a CSS-first architecture using the `@theme` directive in `frontend/src/index.css`.
3. Deleting `frontend/tailwind.config.js` and `frontend/postcss.config.js`.
4. Removing obsolete package overrides in `frontend/package.json`.
5. Implementing automated regression tests verifying that all 16 built-in themes and core composite classes (`btn-primary`, `card`, `input-cozy`) retain 100% visual and functional parity.

---

## 2. Technical Architecture & Component Changes

### 2.1 Build Toolchain & Vite Plugin

- **Target Packages**:
  - Install `@tailwindcss/vite` (v4.x) and `tailwindcss` (v4.x) in `frontend/package.json` devDependencies.
  - Remove `postcss` and `autoprefixer` from `frontend/package.json` devDependencies.
  - Remove the `overrides.tailwindcss["postcss-selector-parser"]` block from `frontend/package.json`.
- **Vite Configuration (`frontend/vite.config.ts`)**:
  - Import the Tailwind Vite plugin: `import tailwindcss from '@tailwindcss/vite';`.
  - Insert `tailwindcss()` into Vite's `plugins` array alongside `react()`.
- **Files to Delete**:
  - `frontend/postcss.config.js`
  - `frontend/tailwind.config.js`

### 2.2 CSS-First Theming Architecture (`frontend/src/index.css`)

In Tailwind CSS v4, the `@tailwind base; @tailwind components; @tailwind utilities;` directives are replaced by `@import "tailwindcss";`.

Design tokens are declared directly in CSS using the `@theme` directive. CozyVTT requires dynamic theme switching where colors resolve against runtime CSS variables defined on `:root` or `[data-theme="..."]`. To support opacity modifier syntax (e.g. `bg-brand/80`), tokens reference CSS custom properties.

#### Token Declarations in `@theme`

```css
@import "tailwindcss";

@theme {
  /* Fonts */
  --font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-serif: 'Cinzel', 'Spectral', Georgia, Cambria, 'Times New Roman', Times, serif;
  --font-display: 'MedievalSharp', 'Cinzel Decorative', cursive, serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  /* Border Radii */
  --radius-cozy: 0.5rem;
  --radius-cozy-lg: 0.75rem;

  /* Box Shadows */
  --shadow-cozy: 0 2px 8px -2px rgba(0, 0, 0, 0.25), 0 1px 4px -1px rgba(0, 0, 0, 0.15);
  --shadow-cozy-lg: 0 8px 24px -4px rgba(0, 0, 0, 0.3), 0 4px 12px -2px rgba(0, 0, 0, 0.2);

  /* Animations */
  --animate-fade-in: fadeIn 0.2s ease-out forwards;
  --animate-slide-in: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  --animate-pulse-soft: pulseSoft 2s ease-in-out infinite;

  /* Dynamic Semantic Colors (mapped to runtime CSS custom properties) */
  --color-background: var(--color-background);
  --color-surface: var(--color-surface);
  --color-surface-hover: var(--color-surface-hover);
  --color-surface-active: var(--color-surface-active);
  --color-brand: var(--color-brand);
  --color-brand-hover: var(--color-brand-hover);
  --color-border: var(--color-border);
  --color-text: var(--color-text);
  --color-text-secondary: var(--color-text-secondary);
  --color-text-muted: var(--color-text-muted);

  /* High-Contrast WCAG Ink Variants */
  --color-brand-ink: var(--color-brand-ink);
  --color-forest-green-ink: var(--color-forest-green-ink);
  --color-moss-green-ink: var(--color-moss-green-ink);
  --color-wood-brown-ink: var(--color-wood-brown-ink);
  --color-ink-brown-ink: var(--color-ink-brown-ink);
  --color-gold-accent-ink: var(--color-gold-accent-ink);
  --color-terracotta-ink: var(--color-terracotta-ink);
  --color-sepia-ink: var(--color-sepia-ink);

  /* Named CozyVTT Historic Palette Aliases */
  --color-parchment: var(--color-parchment, #f4ecd8);
  --color-warm-white: var(--color-warm-white, #faf7f0);
  --color-forest-green: var(--color-forest-green, #2c4c38);
  --color-moss-green: var(--color-moss-green, #4a6b53);
  --color-wood-brown: var(--color-wood-brown, #5c4033);
  --color-ink-brown: var(--color-ink-brown, #2b1d0c);
  --color-gold-accent: var(--color-gold-accent, #c5a059);
  --color-terracotta: var(--color-terracotta, #b85d43);
  --color-sepia: var(--color-sepia, #704214);
}
```

#### Keyframe Declarations

Keyframes must be defined at the CSS root level so `--animate-*` tokens reference them without ambiguity:

```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideIn {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

@keyframes pulseSoft {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.85; transform: scale(0.98); }
}
```

### 2.3 Composite Utility Classes & Component Styling

CozyVTT utilizes several foundational composite classes that unify button styles, panel surfaces, and form controls across the VTT. In Tailwind CSS v4, custom utility classes must be declared cleanly to preserve cascade layer ordering:

- `.btn-primary`: Incorporates `--color-brand`, contrast text via `--color-brand-ink` (or white), `--radius-cozy`, focus rings, and active states.
- `.card`: Incorporates `--color-surface`, `--color-border`, `--radius-cozy`, and `--shadow-cozy`.
- `.input-cozy`: Standardizes text inputs and dropdowns with `--color-surface`, `--color-border`, `--color-text`, focus ring states, and transition curves.

These classes remain located in `frontend/src/index.css` under standard utility/component styling rules, fully compatible with Tailwind v4 cascade priorities.

### 2.4 The 16 CozyVTT Built-in Themes

CozyVTT provides 16 built-in ambiance themes applied via root attributes (e.g. `[data-theme="parchment"]`, `[data-theme="midnight"]`, `[data-theme="forest"]`, etc.). Each theme defines the core CSS custom properties:
- `--color-background`
- `--color-surface`
- `--color-surface-hover`
- `--color-surface-active`
- `--color-brand`
- `--color-brand-hover`
- `--color-border`
- `--color-text`
- `--color-text-secondary`
- `--color-text-muted`
- Associated `*-ink` contrast tokens.

All 16 theme definition selectors in `frontend/src/index.css` remain fully operational without modification because Tailwind 4 seamlessly consumes custom CSS properties via `--color-*: var(...)`.

---

## 3. Dependency Management & Security Audit

1. **`frontend/package.json` Updates**:
   - Remove: `"postcss": "8.5.31"`, `"autoprefixer": "10.6.1"`.
   - Remove: `overrides: { "tailwindcss": { "postcss-selector-parser": "7.1.7" } }`.
   - Upgrade / Add: `"tailwindcss": "^4.0.0"`, `"@tailwindcss/vite": "^4.0.0"`.
2. **Clean Lockfile Regeneration**:
   - Run `npm install` inside `frontend/` to generate an updated `package-lock.json`.
3. **Security Audit**:
   - Execute `npm audit --omit=dev --audit-level=high`.
   - Confirm that zero high or critical vulnerabilities exist.

---

## 4. Automated Testing & Visual Non-Regression Strategy

To ensure zero regressions across themes and utility classes, a dedicated automated test suite is implemented in Vitest.

### 4.1 New Test Suite: `frontend/src/tests/theme-regression.test.ts`

The test suite verifies in JSDOM / Vitest:
1. **Theme Variable Resolution**: Iterates through all 16 built-in themes by setting the theme selector on `document.documentElement` and asserting that computed styles expose non-empty, valid CSS values for:
   - `--color-background`
   - `--color-surface`
   - `--color-brand`
   - `--color-border`
   - `--color-text`
2. **Composite Classes Integrity**: Renders elements styled with `btn-primary`, `card`, and `input-cozy` and asserts class presence, DOM structure, and CSS rule application.
3. **Token Mapping Health**: Confirms that Tailwind v4 utility classes (such as `bg-brand`, `text-brand-ink`, `font-serif`, `rounded-cozy`) evaluate correctly.
4. **Config Deprecation Guard**: Asserts that `frontend/tailwind.config.js` does not exist in the codebase and that no unit tests attempt to import it.

### 4.2 Existing Suite Compatibility

All existing Vitest suites (`npm run test:run`), TypeScript checks (`npm run typecheck`), ESLint rules (`npm run lint`), and build checks (`npm run build`) must pass without failures or warnings.

---

## 5. Detailed Step-by-Step Implementation Sequence

### Step 1: Dependency Cleanup and Tailwind 4 Installation
- In `frontend/package.json`:
  - Remove `postcss` and `autoprefixer` from `devDependencies`.
  - Remove `overrides` section targeting `postcss-selector-parser`.
  - Install `@tailwindcss/vite` and upgrade `tailwindcss` to v4.
- Run `npm install` to update `package-lock.json`.

### Step 2: Build Pipeline Reconfiguration
- In `frontend/vite.config.ts`:
  - Import `@tailwindcss/vite`.
  - Register `tailwindcss()` in the Vite plugin list.
- Delete `frontend/postcss.config.js`.

### Step 3: CSS Configuration & Token Migration
- In `frontend/src/index.css`:
  - Replace `@tailwind base; @tailwind components; @tailwind utilities;` with `@import "tailwindcss";`.
  - Declare the `@theme` block containing fonts, radii, shadows, animations, dynamic colors, and CozyVTT palette aliases.
  - Declare `@keyframes` for `fadeIn`, `slideIn`, and `pulseSoft`.
  - Ensure `.btn-primary`, `.card`, and `.input-cozy` are cleanly declared.
- Delete `frontend/tailwind.config.js`.

### Step 4: Automated Testing Implementation
- Create `frontend/src/tests/theme-regression.test.ts` implementing the verification of:
  - All 16 ambiance themes.
  - Key composite classes (`btn-primary`, `card`, `input-cozy`).
  - Absence of legacy config references.

### Step 5: Verification & Quality Gate Validation
- Execute `npm run typecheck` in `frontend/`.
- Execute `npm run lint` in `frontend/`.
- Execute `npm run test:run` in `frontend/`.
- Execute `npm run build` in `frontend/`.
- Execute `npm audit --omit=dev --audit-level=high` in `frontend/`.

---

## 6. Acceptance Criteria & Traceability Matrix

| Criteria ID | Requirement Description | Verification Method | Target Status |
| :--- | :--- | :--- | :--- |
| **AC-01** | `frontend` builds, typechecks, lints, and passes all Vitest suites on Tailwind CSS 4. | `npm run build && npm run typecheck && npm run lint && npm run test:run` in CI | Enforced |
| **AC-02** | All custom CozyVTT theme tokens (`parchment`, `warm-white`, `forest-green`, `moss-green`, `wood-brown`, `ink-brown`, `gold-accent`, `terracotta`, `sepia`, shadows, animations, fonts) work identically. | `@theme` declarations in `src/index.css` + `theme-regression.test.ts` | Enforced |
| **AC-03** | All 16 built-in themes retain full visual and variable parity without CSS breakage. | Theme iteration test in `theme-regression.test.ts` | Enforced |
| **AC-04** | Composite utility classes (`btn-primary`, `card`, `input-cozy`) remain functional with correct styling cascade. | Unit/Integration assertions in `theme-regression.test.ts` | Enforced |
| **AC-05** | Obsolete `postcss`, `autoprefixer`, and `postcss-selector-parser` overrides are eradicated. | Inspection of `frontend/package.json`, deletion of `postcss.config.js` & `tailwind.config.js` | Enforced |
| **AC-06** | `npm audit --omit=dev --audit-level=high` reports 0 vulnerabilities. | Execution of `npm audit` in `frontend/` | Enforced |

---

## 7. Operational & Security Considerations

- **No Backend Impact**: This refactoring is purely frontend build and styling tooling. No API schemas, WebSocket protocols, database migrations, or server routes are touched.
- **Asset Integrity**: Fonts and SVGs imported via CSS remain resolved identically by Vite's asset pipeline.
- **Production Bundle**: Tailwind 4 optimizes unused CSS rules via Lightning CSS at build time, yielding smaller or equal bundle footprints compared to Tailwind 3 + PurgeCSS/PostCSS.
