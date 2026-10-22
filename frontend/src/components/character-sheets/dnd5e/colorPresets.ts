import type { ColorPreset } from '../SheetHeader';

/** D&D 5e color presets for character sheets. Shared by the editor and view. */
export const DND5E_COLOR_PRESETS: ColorPreset[] = [
  { name: 'Classic Red', from: 'from-red-700', to: 'to-red-900', accent: 'red-700', hex: '#b91c1c' },
  { name: 'Royal Blue', from: 'from-blue-700', to: 'to-blue-900', accent: 'blue-700', hex: '#1d4ed8' },
  { name: 'Forest Green', from: 'from-green-700', to: 'to-green-900', accent: 'green-700', hex: '#15803d' },
  { name: 'Deep Purple', from: 'from-purple-700', to: 'to-purple-900', accent: 'purple-700', hex: '#7e22ce' },
  { name: 'Amber Gold', from: 'from-amber-600', to: 'to-amber-800', accent: 'amber-600', hex: '#d97706' },
  { name: 'Slate Gray', from: 'from-slate-700', to: 'to-slate-900', accent: 'slate-700', hex: '#334155' },
  { name: 'Crimson', from: 'from-rose-700', to: 'to-rose-900', accent: 'rose-700', hex: '#be123c' },
  { name: 'Teal', from: 'from-teal-700', to: 'to-teal-900', accent: 'teal-700', hex: '#0f766e' },
  { name: 'Indigo', from: 'from-indigo-700', to: 'to-indigo-900', accent: 'indigo-700', hex: '#4338ca' },
  { name: 'Emerald', from: 'from-emerald-700', to: 'to-emerald-900', accent: 'emerald-700', hex: '#047857' },
  { name: 'Orange', from: 'from-orange-700', to: 'to-orange-900', accent: 'orange-700', hex: '#c2410c' },
  { name: 'Pink', from: 'from-pink-700', to: 'to-pink-900', accent: 'pink-700', hex: '#be185d' },
];

export const DND5E_DEFAULT_HEX = '#b91c1c';
