import type { ColorPreset } from '../SheetHeader';

/** Vintage presets always carry a bottom-border token used as `border-${border}`. */
export interface CoCColorPreset extends ColorPreset {
  border: string;
}

/** Call of Cthulhu color presets — vintage 1920s aesthetic. Shared by the editor and view. */
export const COC7E_COLOR_PRESETS: CoCColorPreset[] = [
  { name: 'Dark Forest', from: 'from-green-900', to: 'to-green-800', accent: 'green-800', border: 'amber-600', hex: '#14532d' },
  { name: 'Noir Shadow', from: 'from-slate-900', to: 'to-slate-800', accent: 'slate-800', border: 'amber-500', hex: '#0f172a' },
  { name: 'Deep Sepia', from: 'from-sepia-900', to: 'to-sepia-800', accent: 'sepia-800', border: 'sepia-400', hex: '#2E2419' },
  { name: 'Midnight Blue', from: 'from-blue-950', to: 'to-blue-900', accent: 'blue-900', border: 'amber-600', hex: '#172554' },
  { name: 'Burgundy Wine', from: 'from-red-950', to: 'to-red-900', accent: 'red-900', border: 'amber-500', hex: '#450a0a' },
  { name: 'Victorian Purple', from: 'from-purple-950', to: 'to-purple-900', accent: 'purple-900', border: 'amber-600', hex: '#3b0764' },
  { name: 'Emerald Mist', from: 'from-emerald-900', to: 'to-emerald-800', accent: 'emerald-800', border: 'amber-600', hex: '#064e3b' },
  { name: 'Charcoal Gray', from: 'from-gray-900', to: 'to-gray-800', accent: 'gray-800', border: 'amber-500', hex: '#111827' },
  { name: 'Teal Shadow', from: 'from-teal-950', to: 'to-teal-900', accent: 'teal-900', border: 'amber-600', hex: '#042f2e' },
  { name: 'Amber Dusk', from: 'from-amber-900', to: 'to-amber-800', accent: 'amber-800', border: 'amber-400', hex: '#78350f' },
];

export const COC7E_DEFAULT_HEX = '#14532d';
