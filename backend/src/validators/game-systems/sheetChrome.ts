import { z } from 'zod';
import { HEX_COLOR_PATTERN, THEME_COLOR_PATTERN } from '../../utils/styleAllowlists';

/**
 * Fields the app stores on every character sheet, whatever the game system.
 *
 * `themeColor` is the header colour chosen in the editor: the name of one of
 * the editor's presets ("Classic Red") or a `#RRGGBB` colour from the custom
 * picker. The sheet paints that hex as an opaque fill, so the pattern the
 * sheets re-check at render is the one enforced here.
 *
 * A custom hex is also held to WCAG 2.1 contrast of 4.5:1 against fixed white
 * header text (`#FFFFFF`). Pale picks are refused; they are not auto-adjusted.
 * Already-stored pale hex still loads; the client paints white or black name
 * text, whichever contrasts more against that hex, and the next save is
 * refused until it is a passing hex or a preset. Preset names and empty
 * string skip the contrast check.
 */

export const PALE_HEADER_COLOUR_MESSAGE =
  'This colour is too pale for the light name text. Pick a darker colour, or choose a preset.';

/** WCAG AA minimum for body text, same as frontend `AA_TEXT`. */
const AA_TEXT = 4.5;

const WHITE: [number, number, number] = [255, 255, 255];

function parseHexRgb(hex: string): [number, number, number] | null {
  if (!HEX_COLOR_PATTERN.test(hex)) return null;
  const n = hex.slice(1);
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

/** WCAG 2.1 relative luminance, same formula as frontend `utils/color.ts`. */
function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function hexMeetsHeaderContrast(hex: string): boolean {
  const rgb = parseHexRgb(hex);
  if (!rgb) return true;
  return contrastRatio(rgb, WHITE) >= AA_TEXT;
}

export const themeColorSchema = z
  .string()
  .max(40)
  .regex(THEME_COLOR_PATTERN, 'themeColor must be a preset name or a #RRGGBB colour')
  .refine((value) => !HEX_COLOR_PATTERN.test(value) || hexMeetsHeaderContrast(value), {
    message: PALE_HEADER_COLOUR_MESSAGE,
  })
  .optional();
