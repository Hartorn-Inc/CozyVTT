# CozyVTT Design System & UI/UX Contracts (`DESIGN.md`)

CozyVTT is a self-hosted, browser-based virtual tabletop built for narrative-driven RPG campaigns. Its visual identity is warm, tactile, and "cozy" without sacrificing live-table clarity during combat, exploration, and character management.

---

## 1. Visual Direction & Typography

- **Warm Tabletop Aesthetic**: Soft parchment and hearth-inspired default surfaces (`Cozy Default`), paired with 16 built-in themes (12 light/warm, 4 dark) plus user-defined custom palettes and campaign **Vibe** atmosphere filters.
- **Bundled Typefaces** (`frontend/src/assets/fonts/fonts.css`):
  - `--font-heading`: `'Quicksand'`, `'Comfortaa'`, `sans-serif` (headings, panel titles, modal headers).
  - `--font-body`: `'Inter'`, `'Open Sans'`, `sans-serif` (body copy, controls, chat, roster).
  - `--font-mono`: `'JetBrains Mono'`, `monospace` (dice formulas, roll breakdowns, technical identifiers, backup fingerprints).
- **Shared UI Primitives**: Always use `@/components/ui` (`Button`, `Modal`, `Input`, `Field`, `Tooltip`) and `@/components/common` (`ConfirmDialog`, `EmptyState`, `ToastContainer`) rather than ad-hoc raw `<button>` or modal wrappers.

---

## 2. Semantic Theme Tokens & The `-ink` Rule

Every themed color comes from space-separated RGB CSS variables in `frontend/src/index.css` and `frontend/src/themes.ts`, mapped in `frontend/tailwind.config.js` as `rgb(var(--color-x) / <alpha-value>)`.

| Token Group | Tokens | Allowed Usage |
| --- | --- | --- |
| **Brand & Accent** | `brand`, `brand-dark`, `accent`, `accent-hover`, `accent-text` | Button fills, active borders, focus rings, highlights |
| **Surfaces** | `canvas`, `surface`, `surface-light`, `surface-dark`, `paper` | Page canvas, cards, drawers, inputs, modals |
| **Primary Text** | `ink`, `ink-secondary`, `ink-muted` | Body copy, labels, secondary descriptions, muted hints |
| **State Fills** | `danger`, `success`, `warning`, `info`, `spirit` | Alert backgrounds (`/10`, `/15`), borders, badges, spirit-realm accents |
| **Readable `-ink` Text** | `brand-ink`, `accent-ink`, `spirit-ink`, `danger-ink`, `success-ink`, `warning-ink`, `info-ink` | **All colored text and inline icons** on themed surfaces |

### Non-Negotiable Token Invariants

1. **Always use `-ink` tokens when color is used as text**:
   - Use `text-danger-ink`, `text-brand-ink`, `text-accent-ink`, `text-spirit-ink`, `text-success-ink`, `text-warning-ink`, `text-info-ink`.
   - Plain tokens (`accent`, `danger`, `warning`, etc.) are **fills**; as text they can drop below 2:1 contrast. `deriveReadableTokens()` in `frontend/src/themes.ts` walks each `-ink` variant's lightness via `ensureReadable()` (`frontend/src/utils/color.ts`) until it clears WCAG AA against that theme's surfaces (including user-picked custom themes).
2. **Never use raw Tailwind palette utilities on themed surfaces**:
   - Classes such as `bg-red-50`, `text-stone-500`, or `text-blue-600` break on dark and custom themes and fail `frontend/src/utils/__tests__/themeTokens.test.ts`.
   - Use semantic tokens or `.alert-*` / `.badge-*` component classes in `frontend/src/index.css`.
3. **Deliberate Exemptions (`themeTokens.test.ts`)**:
   - **Character sheets** (`frontend/src/components/character-sheets/**`): styled as tactile light "paper" cards matching physical tabletop sheets regardless of app theme.
   - **Dark DM map overlays**: floating translucent HUD controls over the map canvas.
   - Every UI change inside an exempt area must still maintain manual WCAG AA contrast against its fixed paper or dark-overlay background.

---

## 3. Live Table & Focus Surface Rules

- **Map Canvas Primacy (Focus Table)**:
  - The current map canvas is the primary interactive surface on the Campaign table. Side panels (Chat, Dice Roller, Initiative, Roster, Notes) and tool rails must not obscure active token manipulation or trap pointer/wheel gestures meant for the canvas.
- **Wide Tool Rail & DM Information Visibility**:
  - DM table tools (map lock status, fog reveal/hide brush, wall/light editors, spirit-layer toggle, vibe selector) use the wide tool rail pattern with clear active-tool indicators.
  - Critical DM status indicators (current map vs prepared map banner, active session status, spirit-realm indicator, unsaved map lock/error notices) must remain visible or one-tap accessible at every viewport width from `320px` to `1440px`.
- **Resilient Live-Table Feedback (ADR-0010, ADR-0011)**:
  - Disconnecting keeps the last rendered frame on screen with a non-destructive connection status indicator until silent catch-up completes.
  - Failed map loads or failed writes never blank the table into an empty state; they preserve the current view, display an explicit error notice, and offer a retry action.
  - Saving campaign settings patches `CampaignContext` in place without remounting the table or losing canvas pan/zoom state.

---

## 4. Responsive Layout Contracts (`320px`–`1440px`)

- **Desktop (`1024px`–`1440px+`)**:
  - Multi-column dashboard grids, persistent campaign sidebar/rail, and side-by-side character sheet sections without horizontal page scroll.
- **Tablet & Phone (`320px`–`768px`)**:
  - Single-column reflow on dashboards, setup wizard, sign-in, and admin panels; zero horizontal overflow at `320px` CSS width.
  - Campaign table drawers and modals collapse into full-width or bottom/side sheets that can be dismissed via keyboard (`Escape`) and touch without losing table context.
  - Interactive touch targets must provide comfortable hit areas (minimum `44x44px` on primary mobile table and sheet controls).

---

## 5. Accessibility Invariants (WCAG 2.2 AA)

- **Contrast**: Minimum `4.5:1` for normal body/label text and `3:1` for large text (`>=18pt` or `>=14pt bold`) and essential UI graphics/focus indicators across all 16 preset themes and custom themes (`themes.contrast.test.ts`).
- **Keyboard & Focus Management**:
  - Every interactive control must be reachable and operable via keyboard (`Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape`) with a visible focus ring (`focus:ring-2`).
  - Modals and confirmation dialogs (`Modal`, `ConfirmDialog`) must trap focus while open, close on `Escape` (unless an active destructive/restore operation forbids dismissal), and restore focus to the trigger element on close.
- **Semantics & Screen Readers**:
  - Use landmark elements (`main`, `nav`, `section`, `header`, `form`), explicit `<label htmlFor>` or `Field` wrappers for every input, and `aria-describedby` for inline field errors.
  - Dynamic status updates (roll results, toast alerts, form errors, upload progress, connection state changes) must announce via `role="alert"` or `aria-live="polite"`.
- **Non-Color Meaning & Reduced Motion**:
  - Never rely on color alone to convey role, session state, spirit-layer membership, or validation failure; pair color with text labels, badges, or icons.
  - Respect `prefers-reduced-motion: reduce` on page transitions, dice animations, and atmosphere/spirit-layer visual effects.
