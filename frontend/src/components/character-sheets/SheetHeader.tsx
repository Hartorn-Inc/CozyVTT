/**
 * Shared character-sheet header chrome for D&D 5e, Pathfinder 2e, and
 * Call of Cthulhu 7e. Extraction of the painted header, action cluster,
 * edit-only palette, token picture, and name control — not a new look.
 *
 * Flexible and Shadowrun do not use this. Colour values, save payload,
 * token file/upload, and dirty/save wiring stay in each editor.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Edit, Palette, Save, Upload, X } from 'lucide-react';
import { SHEET_NAME_MAX } from '@/constants/sheetLimits';
import {
  CUSTOM_HEADER_CONTROL_SURFACE,
  CUSTOM_HEADER_FIELD_BORDER,
  CUSTOM_HEADER_FIELD_FOCUS,
  CUSTOM_HEADER_FIELD_SURFACE,
  customHeaderFill,
  customHeaderPlaceholderClass,
  customHeaderTextClass,
  THEME_COLOR_ERROR_ID,
} from '@/utils/themeColor';

export interface ColorPreset {
  name: string;
  from: string;
  to: string;
  accent: string;
  hex: string;
  /** Vintage (CoC) bottom-border colour token, used as `border-${border}`. */
  border?: string;
}

export interface HeaderPaint {
  text: string;
  placeholder: string;
  fieldBg: string;
  fieldBorder: string;
  fieldFocus: string;
}

export type SheetHeaderMeta =
  | React.ReactNode
  | ((paint: HeaderPaint) => React.ReactNode);

/**
 * Calculate luminance of a hex color to determine if text should be white or black.
 * Returns true if text should be white (dark background), false if text should be black (light background).
 *
 * Used by gradient editors (D&D 5e, Pathfinder 2e). Do not apply it to CoC
 * parchment chrome or to D&D/PF2e views, which hardcode white on presets.
 */
export const shouldUseWhiteText = (hexColor: string): boolean => {
  // Remove # if present
  const hex = hexColor.replace('#', '');

  // Convert to RGB
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return true for white text if luminance is less than 0.5 (dark background)
  return luminance < 0.5;
};

/**
 * Field-surface classes for a custom vs preset header. Name and system meta
 * fields both use these so custom-header paint stays consistent.
 */
export function headerPaint(args: {
  variant: 'gradient' | 'vintage';
  mode: 'edit' | 'view';
  isCustomColor: boolean;
  customColorHex: string;
  presetHex: string;
}): HeaderPaint {
  const { variant, mode, isCustomColor, customColorHex, presetHex } = args;
  if (isCustomColor) {
    return {
      text: customHeaderTextClass(customColorHex),
      placeholder: customHeaderPlaceholderClass(customColorHex),
      fieldBg: CUSTOM_HEADER_FIELD_SURFACE,
      fieldBorder: CUSTOM_HEADER_FIELD_BORDER,
      fieldFocus: CUSTOM_HEADER_FIELD_FOCUS,
    };
  }
  if (variant === 'vintage') {
    return {
      text: 'text-parchment',
      placeholder: 'placeholder:text-parchment-light/50',
      fieldBg: 'bg-white/10',
      fieldBorder: 'border-white/30',
      fieldFocus: 'focus:ring-2 focus:ring-amber-500',
    };
  }
  // Passing custom hex keeps white name text. Stored pale hex uses dark
  // text so the header is readable; save still refuses until it is a
  // passing hex or a preset. Presets still pick by luminance in editors;
  // D&D/PF2e views hardcode white on presets.
  const text =
    mode === 'view'
      ? 'text-white'
      : shouldUseWhiteText(presetHex)
        ? 'text-white'
        : 'text-stone-900';
  return {
    text,
    placeholder: 'placeholder-current/50',
    fieldBg: 'bg-white/10',
    fieldBorder: 'border-white/20',
    fieldFocus: 'focus:border-white/40',
  };
}

export interface SheetHeaderToken {
  /** Tailwind size classes, e.g. `w-40 h-40` — not CSS pixel values. */
  sizeClass: string;
  preview: string | null;
  alt: string;
  /** Circle ring / shadow classes (D&D `border-4 border-white/20`, CoC amber/sepia). */
  circleClass: string;
  emptyClass: string;
  placeholder: React.ReactNode;
  hover: 'overlay' | 'fade' | 'none';
  /** When false, a missing preview renders no token column (PF2e view). */
  showEmpty?: boolean;
  onFileChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  personalHint?: boolean;
}

export interface SheetHeaderName {
  value: string;
  onChange?: (value: string) => void;
  placeholder: string;
  invalid?: boolean;
  /** Extra classes on the view heading (`mb-1`, CoC `mb-2 drop-shadow-lg`). */
  headingClassName?: string;
  /** View-only fallback when value is empty. Omit to leave the heading empty. */
  emptyDisplay?: string;
}

export interface SheetHeaderProps {
  variant: 'gradient' | 'vintage';
  mode: 'edit' | 'view';
  presets: ColorPreset[];
  selectedPreset: ColorPreset;
  isCustomColor: boolean;
  customColorHex: string;
  defaultHex: string;
  token: SheetHeaderToken;
  name: SheetHeaderName;
  /** Unconstrained system fields under the name (grids, chips, player line). */
  meta?: SheetHeaderMeta;
  /** Right column inside `flex … justify-between` (XP, hero points, CoC view player). */
  trailing?: SheetHeaderMeta;
  extraNameColumnClassName?: string;
  extraNameRowClassName?: string;
  onSave?: () => void;
  onCancel?: () => void;
  isSaving?: boolean;
  /** View Edit is rendered only when this is passed. */
  onEdit?: () => void;
  editTitle?: string;
  colorError?: string;
  onCustomColorChange?: (hex: string) => void;
  onPresetSelect?: (preset: ColorPreset) => void;
  /**
   * Bump this when a refused save should open the picker and focus the hex
   * box. Opening the palette by itself does not focus the hex field.
   */
  colorPickerFocusKey?: number;
}

function resolveMeta(meta: SheetHeaderMeta | undefined, paint: HeaderPaint): React.ReactNode {
  if (meta == null) return null;
  return typeof meta === 'function' ? meta(paint) : meta;
}

export const SheetHeader: React.FC<SheetHeaderProps> = ({
  variant,
  mode,
  presets,
  selectedPreset,
  isCustomColor,
  customColorHex,
  defaultHex,
  token,
  name,
  meta,
  trailing,
  extraNameColumnClassName,
  extraNameRowClassName,
  onSave,
  onCancel,
  isSaving = false,
  onEdit,
  editTitle = 'Edit character',
  colorError,
  onCustomColorChange,
  onPresetSelect,
  colorPickerFocusKey = 0,
}) => {
  const paint = headerPaint({
    variant,
    mode,
    isCustomColor,
    customColorHex,
    presetHex: selectedPreset.hex,
  });
  const [showColorPicker, setShowColorPicker] = useState(false);
  const hexInputRef = useRef<HTMLInputElement>(null);
  const [hexFocusNonce, setHexFocusNonce] = useState(0);
  const tokenInputId = `token-upload-${useId()}`;

  useEffect(() => {
    if (colorPickerFocusKey === 0) return;
    setShowColorPicker(true);
    setHexFocusNonce((n) => n + 1);
  }, [colorPickerFocusKey]);

  useEffect(() => {
    if (!showColorPicker || hexFocusNonce === 0) return;
    hexInputRef.current?.focus();
    hexInputRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [showColorPicker, hexFocusNonce]);

  const headerStyle = isCustomColor ? customHeaderFill(customColorHex) : {};
  const vintageBorder = isCustomColor
    ? 'border-b-4 border-amber-600'
    : `border-b-4 border-${selectedPreset.border ?? 'amber-600'}`;
  const headerClasses = isCustomColor
    ? `${paint.text} p-6 rounded-t-lg relative${variant === 'vintage' ? ` ${vintageBorder}` : ''}`
    : variant === 'vintage'
      ? `bg-gradient-to-r ${selectedPreset.from} via-${selectedPreset.accent} ${selectedPreset.to} ${paint.text} p-6 rounded-t-lg relative ${vintageBorder}`
      : `bg-gradient-to-r ${selectedPreset.from} ${selectedPreset.to} ${paint.text} p-6 rounded-t-lg relative`;

  const handleHexInput = (hex: string) => {
    if (hex === '' || /^#[0-9A-Fa-f]{0,6}$/.test(hex)) {
      onCustomColorChange?.(hex);
    }
  };

  const handlePresetClick = (preset: ColorPreset) => {
    onPresetSelect?.(preset);
    setShowColorPicker(false);
  };

  const showToken =
    Boolean(token.preview) || token.showEmpty !== false;
  const tokenPicture = token.preview ? (
    <img
      src={token.preview}
      alt={token.alt}
      className={`${token.sizeClass} rounded-full ${token.circleClass} object-cover${
        token.hover === 'fade' ? ' group-hover:opacity-75 transition-opacity' : ''
      }`}
    />
  ) : (
    <div
      className={`${token.sizeClass} rounded-full ${token.circleClass} ${token.emptyClass} flex items-center justify-center${
        token.hover === 'fade' ? ' group-hover:bg-sepia-800 transition-colors' : ''
      }`}
    >
      {token.placeholder}
    </div>
  );

  const tokenChrome = !showToken ? null : mode === 'edit' && token.onFileChange ? (
    <div className={`flex-shrink-0 relative${token.hover === 'overlay' ? ' group' : ''}`}>
      {token.hover === 'fade' ? (
        <label htmlFor={tokenInputId} className="cursor-pointer group">
          {tokenPicture}
        </label>
      ) : (
        <label htmlFor={tokenInputId} className="cursor-pointer block relative">
          {tokenPicture}
          <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Upload className="w-12 h-12 text-white" />
          </div>
        </label>
      )}
      <input
        type="file"
        id={tokenInputId}
        accept="image/*"
        onChange={token.onFileChange}
        className="hidden"
      />
      {token.error && (
        <div className="absolute top-full mt-1 text-xs text-red-200 whitespace-nowrap">
          {token.error}
        </div>
      )}
      {token.personalHint && (
        <div className="absolute top-full mt-1 text-xs text-amber-200 whitespace-nowrap">
          Saves as personal token
        </div>
      )}
    </div>
  ) : (
    <div className="flex-shrink-0">{tokenPicture}</div>
  );

  const nameControl =
    mode === 'edit' ? (
      <input
        type="text"
        value={name.value}
        onChange={(e) => name.onChange?.(e.target.value)}
        maxLength={SHEET_NAME_MAX}
        placeholder={name.placeholder}
        className={`w-full text-3xl font-bold ${paint.fieldBg} border-2 ${
          name.invalid ? 'border-red-300' : paint.fieldBorder
        } rounded px-3 py-1 ${paint.text} ${paint.placeholder} focus:outline-none ${paint.fieldFocus}`}
        aria-label={name.placeholder}
        aria-invalid={Boolean(name.invalid)}
      />
    ) : (
      <h2 className={`text-3xl font-bold ${paint.text} ${name.headingClassName ?? ''}`.trim()}>
        {name.value || name.emptyDisplay || ''}
      </h2>
    );

  const paletteSurface = isCustomColor
    ? CUSTOM_HEADER_CONTROL_SURFACE
    : 'bg-white/20 hover:bg-white/30';
  const editSurface =
    variant === 'vintage'
      ? 'bg-amber-600/80 hover:bg-amber-600 text-white shadow-lg'
      : isCustomColor
        ? CUSTOM_HEADER_CONTROL_SURFACE
        : 'bg-white/20 hover:bg-white/30';

  return (
    <div className={headerClasses} style={headerStyle}>
      {mode === 'edit' && (
        <>
          <div className="absolute top-4 right-16 flex items-center space-x-2">
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center space-x-2 font-medium shadow-lg disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Saving...' : 'Save'}</span>
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 bg-red-600/80 hover:bg-red-600 text-white rounded-lg transition-colors flex items-center space-x-2 font-medium shadow-lg"
            >
              <X className="w-4 h-4" />
              <span>Cancel</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowColorPicker((open) => !open)}
            className={`absolute top-4 right-4 p-2 ${paletteSurface} rounded-lg transition-colors`}
            title="Change theme color"
            aria-label="Change theme color"
            aria-expanded={showColorPicker}
            aria-invalid={Boolean(colorError)}
            aria-describedby={colorError && !showColorPicker ? THEME_COLOR_ERROR_ID : undefined}
          >
            <Palette className="w-5 h-5" aria-hidden="true" />
          </button>
          {colorError && !showColorPicker && (
            <p
              id={THEME_COLOR_ERROR_ID}
              role="alert"
              className="absolute top-14 right-4 z-10 max-w-xs rounded-lg bg-white px-3 py-2 text-xs text-red-600 shadow-lg"
            >
              {colorError}
            </p>
          )}

          {showColorPicker && (
            <div className="absolute top-16 right-4 bg-white text-stone-800 rounded-lg shadow-xl p-4 z-10 border-2 border-stone-200 max-w-md">
              <h4 className="font-semibold mb-3">Theme Color</h4>

              <div className="grid grid-cols-3 gap-2 mb-4">
                {presets.map((color) => (
                  <button
                    type="button"
                    key={color.name}
                    onClick={() => handlePresetClick(color)}
                    className={`px-2 py-2 rounded-lg text-sm font-medium transition-all ${
                      !isCustomColor && selectedPreset.name === color.name
                        ? 'ring-2 ring-stone-400 bg-stone-100'
                        : 'hover:bg-stone-50'
                    }`}
                  >
                    <div className={`w-full h-6 rounded mb-1 bg-gradient-to-r ${color.from} ${color.to}`} />
                    <div className="text-xs">{color.name}</div>
                  </button>
                ))}
              </div>

              <div className="border-t pt-4 space-y-3">
                <h5 className="text-sm font-semibold text-stone-700">Custom Color</h5>
                <div className="flex items-center space-x-2">
                  <input
                    type="color"
                    value={customColorHex || defaultHex}
                    onChange={(e) => onCustomColorChange?.(e.target.value)}
                    className="w-12 h-12 rounded cursor-pointer border-2 border-stone-300"
                    title="Pick a custom color"
                  />
                  <div className="flex-1">
                    <input
                      type="text"
                      ref={hexInputRef}
                      value={customColorHex}
                      onChange={(e) => handleHexInput(e.target.value)}
                      placeholder={defaultHex}
                      aria-label="Custom colour hex code"
                      aria-invalid={Boolean(colorError)}
                      aria-describedby={colorError ? THEME_COLOR_ERROR_ID : undefined}
                      className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="text-xs text-stone-500 mt-1">
                      Enter hex code (e.g., {defaultHex})
                    </div>
                    {colorError && (
                      <p id={THEME_COLOR_ERROR_ID} role="alert" className="text-xs text-red-600 mt-1">
                        {colorError}
                      </p>
                    )}
                  </div>
                </div>
                {isCustomColor && customColorHex && /^#[0-9A-Fa-f]{6}$/.test(customColorHex) && (
                  <div className="flex items-center space-x-2 p-2 bg-stone-50 rounded">
                    <div className="w-8 h-8 rounded" style={customHeaderFill(customColorHex)} />
                    <span className="text-sm font-medium">Custom: {customColorHex}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {mode === 'view' && onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className={`absolute top-4 right-4 px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 font-medium ${editSurface}`}
          title={editTitle}
        >
          <Edit className="w-4 h-4" />
          <span>Edit</span>
        </button>
      )}

      {/* pr-64 reserves the strip the absolutely-positioned Save/Cancel cluster
          and palette button occupy above. pr-24 is the view reservation (Edit
          only). Without it the trailing fields sit underneath the actions. */}
      <div
        className={`flex items-start justify-between ${mode === 'edit' ? 'pr-64' : 'pr-24'}`}
      >
        {/* min-w-0 so this column can shrink. Flex children default to
            min-width:auto, which lets the character-name input push out past
            the reserved padding on a narrow window and back under the
            buttons. Applied in both edit and view. */}
        <div className={`flex items-start space-x-4 min-w-0 ${extraNameRowClassName ?? ''}`.trim()}>
          {tokenChrome}
          <div className={`min-w-0 ${extraNameColumnClassName ?? ''}`.trim()}>
            {nameControl}
            {resolveMeta(meta, paint)}
          </div>
        </div>
        {resolveMeta(trailing, paint)}
      </div>
    </div>
  );
};

export default SheetHeader;
