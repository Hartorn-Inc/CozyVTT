import type { ColorPreset } from '../SheetHeader';

/** Pathfinder 2e color presets. Shared by the editor and view. */
export const PF2E_COLOR_PRESETS: ColorPreset[] = [
  { name: 'Pathfinder Blue', from: 'from-blue-700', to: 'to-blue-900', accent: 'blue-700', hex: '#1d4ed8' },
  { name: 'Golden', from: 'from-amber-600', to: 'to-amber-800', accent: 'amber-600', hex: '#d97706' },
  { name: 'Emerald', from: 'from-emerald-700', to: 'to-emerald-900', accent: 'emerald-700', hex: '#047857' },
  { name: 'Royal Purple', from: 'from-purple-700', to: 'to-purple-900', accent: 'purple-700', hex: '#7e22ce' },
  { name: 'Crimson', from: 'from-rose-700', to: 'to-rose-900', accent: 'rose-700', hex: '#be123c' },
  { name: 'Teal', from: 'from-teal-700', to: 'to-teal-900', accent: 'teal-700', hex: '#0f766e' },
  { name: 'Indigo', from: 'from-indigo-700', to: 'to-indigo-900', accent: 'indigo-700', hex: '#4338ca' },
  { name: 'Slate', from: 'from-slate-700', to: 'to-slate-900', accent: 'slate-700', hex: '#334155' },
];

export const PF2E_DEFAULT_HEX = '#1d4ed8';
