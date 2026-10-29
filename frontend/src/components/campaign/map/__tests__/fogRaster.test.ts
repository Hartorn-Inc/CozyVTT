import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  FOG_COLOR_PLAYER,
  FOG_COLOR_DM,
  createFogRasterCanvas,
  buildFogRaster,
  compositeFogRaster,
} from '../fogRaster';

interface RecordedCall {
  method: string;
  args: unknown[];
  fillStyle?: string;
}

class MockContext2D {
  readonly calls: RecordedCall[] = [];
  fillStyle: string = '';
  readonly buffer: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.buffer = new Uint8ClampedArray(width * height * 4);
  }

  createImageData(w: number, h: number): ImageData {
    return {
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    } as ImageData;
  }

  putImageData(img: ImageData, dx: number, dy: number): void {
    this.calls.push({ method: 'putImageData', args: [img, dx, dy] });
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const destX = dx + x;
        const destY = dy + y;
        if (destX < 0 || destX >= this.width || destY < 0 || destY >= this.height) continue;
        const srcIdx = (y * img.width + x) * 4;
        const destIdx = (destY * this.width + destX) * 4;
        this.buffer[destIdx] = img.data[srcIdx]!;
        this.buffer[destIdx + 1] = img.data[srcIdx + 1]!;
        this.buffer[destIdx + 2] = img.data[srcIdx + 2]!;
        this.buffer[destIdx + 3] = img.data[srcIdx + 3]!;
      }
    }
  }

  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData {
    this.calls.push({ method: 'getImageData', args: [sx, sy, sw, sh] });
    const data = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const srcX = sx + x;
        const srcY = sy + y;
        const destIdx = (y * sw + x) * 4;
        if (srcX >= 0 && srcX < this.width && srcY >= 0 && srcY < this.height) {
          const srcIdx = (srcY * this.width + srcX) * 4;
          data[destIdx] = this.buffer[srcIdx]!;
          data[destIdx + 1] = this.buffer[srcIdx + 1]!;
          data[destIdx + 2] = this.buffer[srcIdx + 2]!;
          data[destIdx + 3] = this.buffer[srcIdx + 3]!;
        }
      }
    }
    return { width: sw, height: sh, data } as ImageData;
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: 'clearRect', args: [x, y, w, h] });
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        if (col < 0 || col >= this.width || row < 0 || row >= this.height) continue;
        const idx = (row * this.width + col) * 4;
        this.buffer[idx] = 0;
        this.buffer[idx + 1] = 0;
        this.buffer[idx + 2] = 0;
        this.buffer[idx + 3] = 0;
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ method: 'fillRect', args: [x, y, w, h], fillStyle: this.fillStyle });
    const match = this.fillStyle.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    let r = 0, g = 0, b = 0, a = 255;
    if (match) {
      r = parseInt(match[1]!, 10);
      g = parseInt(match[2]!, 10);
      b = parseInt(match[3]!, 10);
      if (match[4] !== undefined) {
        a = Math.round(parseFloat(match[4]) * 255);
      }
    }
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        if (col < 0 || col >= this.width || row < 0 || row >= this.height) continue;
        const idx = (row * this.width + col) * 4;
        this.buffer[idx] = r;
        this.buffer[idx + 1] = g;
        this.buffer[idx + 2] = b;
        this.buffer[idx + 3] = a;
      }
    }
  }

  drawImage(src: HTMLCanvasElement, dx: number, dy: number): void {
    this.calls.push({ method: 'drawImage', args: [src, dx, dy] });
    const srcCtx = (src as unknown as { __mockCtx?: MockContext2D }).__mockCtx;
    if (!srcCtx) return;
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const destX = dx + x;
        const destY = dy + y;
        if (destX < 0 || destX >= this.width || destY < 0 || destY >= this.height) continue;
        const srcIdx = (y * src.width + x) * 4;
        const destIdx = (destY * this.width + destX) * 4;
        this.buffer[destIdx] = srcCtx.buffer[srcIdx]!;
        this.buffer[destIdx + 1] = srcCtx.buffer[srcIdx + 1]!;
        this.buffer[destIdx + 2] = srcCtx.buffer[srcIdx + 2]!;
        this.buffer[destIdx + 3] = srcCtx.buffer[srcIdx + 3]!;
      }
    }
  }
}

const ctxMap = new WeakMap<HTMLCanvasElement, MockContext2D>();

function getMockContext(canvas: HTMLCanvasElement): MockContext2D {
  let ctx = ctxMap.get(canvas);
  if (!ctx || ctx.width !== canvas.width || ctx.height !== canvas.height) {
    ctx = new MockContext2D(canvas.width, canvas.height);
    ctxMap.set(canvas, ctx);
    (canvas as unknown as { __mockCtx: MockContext2D }).__mockCtx = ctx;
  }
  return ctx;
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string) {
    if (contextId === '2d') {
      return getMockContext(this) as unknown as CanvasRenderingContext2D;
    }
    return null;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

describe('fog color constants', () => {
  it('defines FOG_COLOR_PLAYER as opaque deep purple RGBA(15, 12, 25, 255)', () => {
    expect(FOG_COLOR_PLAYER).toEqual({ r: 15, g: 12, b: 25, a: 255 });
  });

  it('defines FOG_COLOR_DM as 55% semi-transparent deep purple RGBA(15, 12, 25, 140)', () => {
    expect(FOG_COLOR_DM).toEqual({ r: 15, g: 12, b: 25, a: 140 });
  });
});

describe('createFogRasterCanvas', () => {
  it('instantiates an HTMLCanvasElement with specified cols and rows dimensions', () => {
    const canvas = createFogRasterCanvas(30, 20);
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas.width).toBe(30);
    expect(canvas.height).toBe(20);
  });

  it('clamps negative dimensions to 0', () => {
    const canvas = createFogRasterCanvas(-5, -10);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });
});

describe('buildFogRaster', () => {
  it('creates canvas with cols x rows dimensions', () => {
    const raster = buildFogRaster(4, 3, false, new Set());
    expect(raster.width).toBe(4);
    expect(raster.height).toBe(3);
  });

  it('populates revealed cells with complete transparency RGBA(0, 0, 0, 0) for player Set', () => {
    const revealed = new Set([0, 3]);
    const raster = buildFogRaster(2, 2, false, revealed);
    const ctx = getMockContext(raster);
    const { data } = ctx.getImageData(0, 0, 2, 2);

    // Cell 0 revealed: [0, 0, 0, 0]
    expect(Array.from(data.slice(0, 4))).toEqual([0, 0, 0, 0]);
    // Cell 1 unrevealed: player fog color
    expect(Array.from(data.slice(4, 8))).toEqual([15, 12, 25, 255]);
    // Cell 2 unrevealed: player fog color
    expect(Array.from(data.slice(8, 12))).toEqual([15, 12, 25, 255]);
    // Cell 3 revealed: [0, 0, 0, 0]
    expect(Array.from(data.slice(12, 16))).toEqual([0, 0, 0, 0]);
  });

  it('populates unrevealed cells with RGBA(15, 12, 25, 255) for player view', () => {
    const raster = buildFogRaster(2, 1, false, new Set());
    const ctx = getMockContext(raster);
    const { data } = ctx.getImageData(0, 0, 2, 1);
    expect(Array.from(data.slice(0, 4))).toEqual([15, 12, 25, 255]);
    expect(Array.from(data.slice(4, 8))).toEqual([15, 12, 25, 255]);
  });

  it('populates unrevealed cells with RGBA(15, 12, 25, 140) for DM view with boolean array', () => {
    const revealed = [false, true, false, true];
    const raster = buildFogRaster(2, 2, true, revealed);
    const ctx = getMockContext(raster);
    const { data } = ctx.getImageData(0, 0, 2, 2);

    // Cell 0 unrevealed: DM fog color
    expect(Array.from(data.slice(0, 4))).toEqual([15, 12, 25, 140]);
    // Cell 1 revealed: transparent
    expect(Array.from(data.slice(4, 8))).toEqual([0, 0, 0, 0]);
    // Cell 2 unrevealed: DM fog color
    expect(Array.from(data.slice(8, 12))).toEqual([15, 12, 25, 140]);
    // Cell 3 revealed: transparent
    expect(Array.from(data.slice(12, 16))).toEqual([0, 0, 0, 0]);
  });

  it('handles null and undefined revealed state by fogging every cell', () => {
    const fromNull = buildFogRaster(1, 1, false, null);
    const { data: dataNull } = getMockContext(fromNull).getImageData(0, 0, 1, 1);
    expect(Array.from(dataNull)).toEqual([15, 12, 25, 255]);

    const fromUndef = buildFogRaster(1, 1, true, undefined);
    const { data: dataUndef } = getMockContext(fromUndef).getImageData(0, 0, 1, 1);
    expect(Array.from(dataUndef)).toEqual([15, 12, 25, 140]);
  });

  it('correctly maps row-major indices (row * cols + col) to buffer pixels', () => {
    // 4 cols x 3 rows -> col 2, row 1 = index 6
    const revealed = new Set([6]);
    const raster = buildFogRaster(4, 3, false, revealed);
    const { data } = getMockContext(raster).getImageData(0, 0, 4, 3);

    expect(Array.from(data.slice(6 * 4, 6 * 4 + 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(data.slice(5 * 4, 5 * 4 + 4))).toEqual([15, 12, 25, 255]);
    expect(Array.from(data.slice(7 * 4, 7 * 4 + 4))).toEqual([15, 12, 25, 255]);
  });

  it('returns empty canvas when cols or rows are zero or negative', () => {
    const zero = buildFogRaster(0, 5, false, new Set());
    expect(zero.width).toBe(0);
    expect(zero.height).toBe(5);
  });
});

describe('compositeFogRaster', () => {
  it('returns direct reference of staticRaster when exemptCells and revealOpacity are absent or empty', () => {
    const staticRaster = buildFogRaster(3, 3, false, new Set());

    expect(compositeFogRaster(staticRaster, 3, 3, false)).toBe(staticRaster);
    expect(compositeFogRaster(staticRaster, 3, 3, false, null, null)).toBe(staticRaster);
    expect(compositeFogRaster(staticRaster, 3, 3, false, new Set(), new Map())).toBe(staticRaster);
    expect(compositeFogRaster(staticRaster, 3, 3, false, new Set(), null)).toBe(staticRaster);
    expect(compositeFogRaster(staticRaster, 3, 3, false, null, new Map())).toBe(staticRaster);
  });

  it('blits staticRaster onto scratchCanvas and clears exemptCells without mutating staticRaster', () => {
    const staticRaster = buildFogRaster(3, 3, false, new Set());
    const scratchCanvas = createFogRasterCanvas(3, 3);
    const exemptCells = new Set([4]); // center cell (col 1, row 1)

    const result = compositeFogRaster(staticRaster, 3, 3, false, exemptCells, null, scratchCanvas);
    expect(result).toBe(scratchCanvas);

    const scratchCtx = getMockContext(scratchCanvas);
    const drawCalls = scratchCtx.calls.filter((c) => c.method === 'drawImage');
    expect(drawCalls).toHaveLength(1);
    expect(drawCalls[0]?.args).toEqual([staticRaster, 0, 0]);

    // Exempt cell (idx 4) is cleared on scratchCanvas
    const scratchData = scratchCtx.getImageData(0, 0, 3, 3).data;
    expect(Array.from(scratchData.slice(4 * 4, 4 * 4 + 4))).toEqual([0, 0, 0, 0]);
    // Adjacent cell (idx 0) retains staticRaster fog
    expect(Array.from(scratchData.slice(0, 4))).toEqual([15, 12, 25, 255]);

    // staticRaster was NOT mutated
    const staticData = getMockContext(staticRaster).getImageData(0, 0, 3, 3).data;
    expect(Array.from(staticData.slice(4 * 4, 4 * 4 + 4))).toEqual([15, 12, 25, 255]);
  });

  it('calculates and applies appropriate transition opacity for revealOpacity', () => {
    const staticRaster = buildFogRaster(2, 2, false, new Set());
    const scratchCanvas = createFogRasterCanvas(2, 2);
    // Cell 1 at 40% fade
    const revealOpacity = new Map([[1, 0.4]]);

    compositeFogRaster(staticRaster, 2, 2, false, null, revealOpacity, scratchCanvas);

    const scratchData = getMockContext(scratchCanvas).getImageData(0, 0, 2, 2).data;
    const cell1Rgba = Array.from(scratchData.slice(1 * 4, 1 * 4 + 4));
    expect(cell1Rgba[0]).toBe(15);
    expect(cell1Rgba[1]).toBe(12);
    expect(cell1Rgba[2]).toBe(25);
    // Alpha for player: 255 * 0.4 = 102
    expect(cell1Rgba[3]).toBe(102);

    // Unaffected cell 0 retains full opacity
    expect(Array.from(scratchData.slice(0, 4))).toEqual([15, 12, 25, 255]);
  });

  it('calculates and applies appropriate transition opacity for DM view', () => {
    const staticRaster = buildFogRaster(2, 2, true, [false, false, false, false]);
    const scratchCanvas = createFogRasterCanvas(2, 2);
    // Cell 2 at 50% fade for DM: 140 * 0.5 = 70
    const revealOpacity = new Map([[2, 0.5]]);

    compositeFogRaster(staticRaster, 2, 2, true, null, revealOpacity, scratchCanvas);

    const scratchData = getMockContext(scratchCanvas).getImageData(0, 0, 2, 2).data;
    const cell2Rgba = Array.from(scratchData.slice(2 * 4, 2 * 4 + 4));
    expect(cell2Rgba[0]).toBe(15);
    expect(cell2Rgba[1]).toBe(12);
    expect(cell2Rgba[2]).toBe(25);
    expect(cell2Rgba[3]).toBe(70);
  });

  it('leaves fully faded transition cell (fade <= 0) completely transparent', () => {
    const staticRaster = buildFogRaster(2, 2, false, new Set());
    const scratchCanvas = createFogRasterCanvas(2, 2);
    const revealOpacity = new Map([[0, 0]]);

    compositeFogRaster(staticRaster, 2, 2, false, null, revealOpacity, scratchCanvas);

    const scratchData = getMockContext(scratchCanvas).getImageData(0, 0, 2, 2).data;
    expect(Array.from(scratchData.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('prioritizes exemptCells over revealOpacity when a cell is present in both', () => {
    const staticRaster = buildFogRaster(2, 2, false, new Set());
    const scratchCanvas = createFogRasterCanvas(2, 2);
    const exemptCells = new Set([1]);
    const revealOpacity = new Map([[1, 0.8]]);

    compositeFogRaster(staticRaster, 2, 2, false, exemptCells, revealOpacity, scratchCanvas);

    const scratchData = getMockContext(scratchCanvas).getImageData(0, 0, 2, 2).data;
    // Cell 1 must be cleared, not tinted
    expect(Array.from(scratchData.slice(1 * 4, 1 * 4 + 4))).toEqual([0, 0, 0, 0]);
  });

  it('creates a scratch canvas when none is provided', () => {
    const staticRaster = buildFogRaster(2, 2, false, new Set());
    const exemptCells = new Set([0]);

    const result = compositeFogRaster(staticRaster, 2, 2, false, exemptCells);
    expect(result).toBeInstanceOf(HTMLCanvasElement);
    expect(result).not.toBe(staticRaster);
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
  });

  it('resizes provided scratch canvas to match cols x rows if needed', () => {
    const staticRaster = buildFogRaster(4, 4, false, new Set());
    const scratchCanvas = createFogRasterCanvas(1, 1);
    const exemptCells = new Set([0]);

    const result = compositeFogRaster(staticRaster, 4, 4, false, exemptCells, null, scratchCanvas);
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
  });

  it('ignores out-of-bounds indices in exemptCells and revealOpacity', () => {
    const staticRaster = buildFogRaster(2, 2, false, new Set());
    const scratchCanvas = createFogRasterCanvas(2, 2);
    const exemptCells = new Set([-1, 999]);
    const revealOpacity = new Map([[-2, 0.5], [100, 0.5]]);

    expect(() => {
      compositeFogRaster(staticRaster, 2, 2, false, exemptCells, revealOpacity, scratchCanvas);
    }).not.toThrow();
  });
});
