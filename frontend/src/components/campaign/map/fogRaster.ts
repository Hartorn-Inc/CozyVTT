// ============================================;
// Manual fog rasterization and composition.
// Encapsulates 1px-per-cell offscreen canvas rasters for fog of war.
// Pure: no React, no component closures.
// ============================================;

export interface FogColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export const FOG_COLOR_PLAYER: FogColor = { r: 15, g: 12, b: 25, a: 255 };
export const FOG_COLOR_DM: FogColor = { r: 15, g: 12, b: 25, a: 140 };

export function createFogRasterCanvas(cols: number, rows: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(0, cols);
  canvas.height = Math.max(0, rows);
  return canvas;
}

export function buildFogRaster(
  cols: number,
  rows: number,
  isDM: boolean,
  revealed: ReadonlySet<number> | readonly boolean[] | null | undefined
): HTMLCanvasElement {
  const canvas = createFogRasterCanvas(cols, rows);
  if (cols <= 0 || rows <= 0) return canvas;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const color = isDM ? FOG_COLOR_DM : FOG_COLOR_PLAYER;
  const img = typeof ctx.createImageData === 'function'
    ? ctx.createImageData(cols, rows)
    : ({ width: cols, height: rows, data: new Uint8ClampedArray(cols * rows * 4) } as ImageData);
  const data = img.data;
  const total = cols * rows;

  const isSet = revealed && typeof (revealed as ReadonlySet<number>).has === 'function';
  const isArr = Array.isArray(revealed);

  for (let i = 0; i < total; i++) {
    const isCellRevealed = isSet
      ? (revealed as ReadonlySet<number>).has(i)
      : isArr
      ? Boolean((revealed as readonly boolean[])[i])
      : false;

    const offset = i * 4;
    if (isCellRevealed) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    } else {
      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = color.a;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function compositeFogRaster(
  staticRaster: HTMLCanvasElement,
  cols: number,
  rows: number,
  isDM: boolean,
  exemptCells?: ReadonlySet<number> | null,
  revealOpacity?: ReadonlyMap<number, number> | null,
  scratchCanvas?: HTMLCanvasElement | null
): HTMLCanvasElement {
  const hasExempt = Boolean(exemptCells && exemptCells.size > 0);
  const hasReveal = Boolean(revealOpacity && revealOpacity.size > 0);

  if (!hasExempt && !hasReveal) {
    return staticRaster;
  }

  if (cols <= 0 || rows <= 0) {
    return staticRaster;
  }

  const target = scratchCanvas ?? createFogRasterCanvas(cols, rows);
  if (target.width !== cols) target.width = cols;
  if (target.height !== rows) target.height = rows;

  const ctx = target.getContext('2d');
  if (!ctx) return target;

  ctx.clearRect(0, 0, cols, rows);
  ctx.drawImage(staticRaster, 0, 0);

  const total = cols * rows;
  const color = isDM ? FOG_COLOR_DM : FOG_COLOR_PLAYER;

  if (revealOpacity && revealOpacity.size > 0) {
    for (const [idx, fadeOpacity] of revealOpacity) {
      if (idx < 0 || idx >= total) continue;
      if (typeof fadeOpacity !== 'number' || Number.isNaN(fadeOpacity)) continue;
      if (exemptCells && exemptCells.has(idx)) continue;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      ctx.clearRect(col, row, 1, 1);
      const clampedFade = Math.max(0, Math.min(1, fadeOpacity));
      if (clampedFade > 0) {
        const alpha = (color.a * clampedFade) / 255;
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
        ctx.fillRect(col, row, 1, 1);
      }
    }
  }

  if (exemptCells && exemptCells.size > 0) {
    for (const idx of exemptCells) {
      if (idx < 0 || idx >= total) continue;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      ctx.clearRect(col, row, 1, 1);
    }
  }

  return target;
}
