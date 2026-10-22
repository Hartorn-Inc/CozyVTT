/**
 * The custom header colour a character sheet saves.
 *
 * The server accepts a preset's name or a six-digit `#rrggbb` colour (see
 * styleAllowlists). The editors' hex box takes what a person types, and `#fff`
 * is a colour every browser understands, so the three-digit form is expanded
 * here. Anything else, from a bare `#` to five digits, is not a colour yet.
 *
 * A completed custom hex must also meet WCAG 2.1 contrast of 4.5:1 against
 * the fixed light header text (`#FFFFFF`). Pale picks are refused on save;
 * they are not auto-adjusted. Already-stored pale hex still loads; the view
 * and editor paint dark name text so the sheet is readable until the next
 * save is a passing hex or a preset. The stored colour is not rewritten.
 */

import { AA_TEXT, contrastRatio, type Rgb } from './color';
import { HEX_COLOR_PATTERN, isHexColor } from './styleAllowlists';

/** What the editors say when the hex box holds something that is not a colour. */
export const HEX_COLOUR_HINT = 'Enter a colour as #rgb or #rrggbb';

/** What the editors and the API say when a custom hex is too pale for white text. */
export const PALE_HEADER_COLOUR_MESSAGE =
  'This colour is too pale for the light name text. Pick a darker colour, or choose a preset.';

/** Id of the theme-colour error, for `aria-describedby` on the hex box. */
export const THEME_COLOR_ERROR_ID = 'sheet-theme-color-error';

/**
 * Inline fill for a custom header. The hex the save rule checks is the
 * painted colour — no translucent gradient endpoint that would lighten it.
 */
export function customHeaderFill(hex: string): { background: string } {
  return { background: hex };
}

/**
 * Placeholder classes on custom-header fields. Half-opacity white would fail
 * 4.5:1 on a colour that only just passes for solid white.
 */
export const CUSTOM_HEADER_PLACEHOLDER_CLASS = 'placeholder:text-white';

/** Dark name text used when a stored or in-progress custom hex fails 4.5:1. */
export const CUSTOM_HEADER_TEXT_DARK = 'text-stone-900';

/** Field fill on a custom header: the validated hex, not a 10% white wash. */
export const CUSTOM_HEADER_FIELD_SURFACE = 'bg-transparent';

/**
 * Name-text class for a custom header. A passing hex keeps white; a pale
 * stored hex uses dark text so the view stays readable. Save still refuses
 * the pale pick — this does not rewrite the colour.
 */
export function customHeaderTextClass(hex: string): string {
  const stored = toStoredHexColor(hex);
  if (stored && headerHexMeetsContrast(stored)) return 'text-white';
  return CUSTOM_HEADER_TEXT_DARK;
}

/** Placeholder class matching {@link customHeaderTextClass}. */
export function customHeaderPlaceholderClass(hex: string): string {
  return customHeaderTextClass(hex) === CUSTOM_HEADER_TEXT_DARK
    ? 'placeholder:text-stone-900'
    : CUSTOM_HEADER_PLACEHOLDER_CLASS;
}

const WHITE: Rgb = [255, 255, 255];

/** `value` as `#rrggbb`, or null when it is not a hex colour. */
export function toStoredHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (isHexColor(trimmed)) return trimmed;
  const short = /^#([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])$/.exec(trimmed);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : null;
}

function parseHexRgb(hex: string): Rgb | null {
  if (!HEX_COLOR_PATTERN.test(hex)) return null;
  const n = hex.slice(1);
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

/**
 * Whether a stored or completed custom hex meets 4.5:1 against white header
 * text. Unfinished hex is not a colour yet — call this only after
 * {@link toStoredHexColor} succeeds.
 */
export function headerHexMeetsContrast(hex: string): boolean {
  const rgb = parseHexRgb(hex);
  if (!rgb) return false;
  return contrastRatio(rgb, WHITE) >= AA_TEXT;
}

/**
 * Why a custom hex must not be saved, or `undefined` when it may. Unfinished
 * hex uses {@link HEX_COLOUR_HINT}; a completed pale pick uses
 * {@link PALE_HEADER_COLOUR_MESSAGE}. Presets and an empty box skip this.
 */
export function customHeaderColourError(isCustom: boolean, hex: string): string | undefined {
  if (!isCustom || hex === '') return undefined;
  const stored = toStoredHexColor(hex);
  if (!stored) return HEX_COLOUR_HINT;
  if (!headerHexMeetsContrast(stored)) return PALE_HEADER_COLOUR_MESSAGE;
  return undefined;
}
