import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drawFog, type FogDrawState } from '../drawFog';
import { buildFogRaster } from '../../fogRaster';
import type { Viewport } from '../types';
import type { FogState } from '@/types/walls';

interface RecordedCall {
  method: string;
  args: unknown[];
  fillStyle?: string;
}

class MockOffscreenContext2D {
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
    const srcCtx = (src as unknown as { __mockCtx?: MockOffscreenContext2D }).__mockCtx;
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

const offscreenCtxMap = new WeakMap<HTMLCanvasElement, MockOffscreenContext2D>();

function getMockOffscreenContext(canvas: HTMLCanvasElement): MockOffscreenContext2D {
  let ctx = offscreenCtxMap.get(canvas);
  if (!ctx || ctx.width !== canvas.width || ctx.height !== canvas.height) {
    ctx = new MockOffscreenContext2D(canvas.width, canvas.height);
    offscreenCtxMap.set(canvas, ctx);
    (canvas as unknown as { __mockCtx: MockOffscreenContext2D }).__mockCtx = ctx;
  }
  return ctx;
}

interface MockMainCtx {
  calls: RecordedCall[];
  imageSmoothingEnabled: boolean;
  smoothingDuringDraw: boolean[];
  save: () => void;
  restore: () => void;
  fillRect: (...args: unknown[]) => void;
  drawImage: (...args: unknown[]) => void;
}

function makeMainCtx(initialSmoothing = true): MockMainCtx & CanvasRenderingContext2D {
  const calls: RecordedCall[] = [];
  const smoothingDuringDraw: boolean[] = [];
  const mainCtx = {
    calls,
    imageSmoothingEnabled: initialSmoothing,
    smoothingDuringDraw,
    save() {
      calls.push({ method: 'save', args: [] });
    },
    restore() {
      calls.push({ method: 'restore', args: [] });
    },
    fillRect(...args: unknown[]) {
      calls.push({ method: 'fillRect', args });
    },
    drawImage(...args: unknown[]) {
      smoothingDuringDraw.push(this.imageSmoothingEnabled);
      calls.push({ method: 'drawImage', args });
    },
  };
  return mainCtx as unknown as MockMainCtx & CanvasRenderingContext2D;
}

const viewport3x3: Viewport = {
  zoom: 1,
  panOffset: { x: 0, y: 0 },
  gridSize: 50,
  mapWidth: 3,
  mapHeight: 3,
};

const dmFogState3x3: FogState = {
  fogCols: 3,
  fogRows: 3,
  cellPx: 50,
  revealed: [true, false, false, false, false, false, false, false, true],
};

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string) {
    if (contextId === '2d') {
      return getMockOffscreenContext(this) as unknown as CanvasRenderingContext2D;
    }
    return null;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

describe('drawFog interface FogDrawState', () => {
  it('accepts optional raster and scratchCanvas properties', () => {
    const raster = document.createElement('canvas');
    const scratch = document.createElement('canvas');
    const state: FogDrawState = {
      isDM: false,
      fogState: null,
      revealedCells: new Set([0]),
      revealOpacity: new Map(),
      raster,
      scratchCanvas: scratch,
    };
    expect(state.raster).toBe(raster);
    expect(state.scratchCanvas).toBe(scratch);
  });
});

describe('drawFog DM view (isDM: true)', () => {
  it('draws a single drawImage call and zero fillRect calls', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: true,
      fogState: dmFogState3x3,
      revealedCells: null,
      revealOpacity: new Map(),
    }, viewport3x3);

    expect(mainCtx.calls.filter((c) => c.method === 'drawImage')).toHaveLength(1);
    expect(mainCtx.calls.filter((c) => c.method === 'fillRect')).toHaveLength(0);
  });

  it('computes mapWidthPx and mapHeightPx as fogCols * cellPx and scales drawImage', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: true,
      fogState: dmFogState3x3,
      revealedCells: null,
      revealOpacity: new Map(),
    }, viewport3x3);

    const drawCall = mainCtx.calls.find((c) => c.method === 'drawImage');
    expect(drawCall?.args).toEqual([expect.any(HTMLCanvasElement), 0, 0, 150, 150]);
  });

  it('disables imageSmoothingEnabled before drawImage and restores it afterwards', () => {
    const mainCtx = makeMainCtx(true);
    drawFog(mainCtx, {
      isDM: true,
      fogState: dmFogState3x3,
      revealedCells: null,
      revealOpacity: new Map(),
    }, viewport3x3);

    expect(mainCtx.smoothingDuringDraw).toEqual([false]);
    expect(mainCtx.imageSmoothingEnabled).toBe(true);
  });

  it('preserves prior imageSmoothingEnabled when it was initially false', () => {
    const mainCtx = makeMainCtx(false);
    drawFog(mainCtx, {
      isDM: true,
      fogState: dmFogState3x3,
      revealedCells: null,
      revealOpacity: new Map(),
    }, viewport3x3);

    expect(mainCtx.smoothingDuringDraw).toEqual([false]);
    expect(mainCtx.imageSmoothingEnabled).toBe(false);
  });

  it('calls ctx.save before drawing and ctx.restore after drawing', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: true,
      fogState: dmFogState3x3,
      revealedCells: null,
      revealOpacity: new Map(),
    }, viewport3x3);

    const methods = mainCtx.calls.map((c) => c.method);
    expect(methods[0]).toBe('save');
    expect(methods[1]).toBe('drawImage');
    expect(methods[2]).toBe('restore');
  });

  it('automatically instantiates fallback raster when state.raster is not provided or null', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: true,
      fogState: dmFogState3x3,
      revealedCells: null,
      revealOpacity: new Map(),
      raster: null,
    }, viewport3x3);

    const drawCall = mainCtx.calls.find((c) => c.method === 'drawImage');
    const raster = drawCall?.args[0] as HTMLCanvasElement;
    expect(raster).toBeInstanceOf(HTMLCanvasElement);
    expect(raster.width).toBe(3);
    expect(raster.height).toBe(3);
  });

  it('uses state.raster directly when provided instead of rebuilding', () => {
    const customRaster = buildFogRaster(3, 3, true, [false, false, false, false, false, false, false, false, false]);
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: true,
      fogState: dmFogState3x3,
      revealedCells: null,
      revealOpacity: new Map(),
      raster: customRaster,
    }, viewport3x3);

    const drawCall = mainCtx.calls.find((c) => c.method === 'drawImage');
    expect(drawCall?.args[0]).toBe(customRaster);
  });

  it('does nothing when state.fogState is null', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: true,
      fogState: null,
      revealedCells: null,
      revealOpacity: new Map(),
    }, viewport3x3);

    expect(mainCtx.calls).toHaveLength(0);
  });

  it('does nothing when fogCols or fogRows <= 0', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: true,
      fogState: { ...dmFogState3x3, fogCols: 0 },
      revealedCells: null,
      revealOpacity: new Map(),
    }, viewport3x3);

    expect(mainCtx.calls).toHaveLength(0);
  });
});

describe('drawFog Player view (isDM: false)', () => {
  it('draws a single drawImage call and zero fillRect calls', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: new Set([0, 4]),
      revealOpacity: new Map(),
    }, viewport3x3);

    expect(mainCtx.calls.filter((c) => c.method === 'drawImage')).toHaveLength(1);
    expect(mainCtx.calls.filter((c) => c.method === 'fillRect')).toHaveLength(0);
  });

  it('computes mapWidthPx and mapHeightPx as fogCols * cellPx and scales drawImage', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: new Set([0, 4]),
      revealOpacity: new Map(),
    }, viewport3x3);

    const drawCall = mainCtx.calls.find((c) => c.method === 'drawImage');
    expect(drawCall?.args).toEqual([expect.any(HTMLCanvasElement), 0, 0, 150, 150]);
  });

  it('disables imageSmoothingEnabled before drawImage and restores it afterwards', () => {
    const mainCtx = makeMainCtx(true);
    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: new Set([0]),
      revealOpacity: new Map(),
    }, viewport3x3);

    expect(mainCtx.smoothingDuringDraw).toEqual([false]);
    expect(mainCtx.imageSmoothingEnabled).toBe(true);
  });

  it('preserves prior imageSmoothingEnabled when it was initially false', () => {
    const mainCtx = makeMainCtx(false);
    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: new Set([0]),
      revealOpacity: new Map(),
    }, viewport3x3);

    expect(mainCtx.smoothingDuringDraw).toEqual([false]);
    expect(mainCtx.imageSmoothingEnabled).toBe(false);
  });

  it('calls ctx.save before drawing and ctx.restore after drawing', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: new Set([0]),
      revealOpacity: new Map(),
    }, viewport3x3);

    const methods = mainCtx.calls.map((c) => c.method);
    expect(methods[0]).toBe('save');
    expect(methods[1]).toBe('drawImage');
    expect(methods[2]).toBe('restore');
  });

  it('automatically instantiates fallback raster when state.raster is not provided or null', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: new Set([0]),
      revealOpacity: new Map(),
    }, viewport3x3);

    const drawCall = mainCtx.calls.find((c) => c.method === 'drawImage');
    const raster = drawCall?.args[0] as HTMLCanvasElement;
    expect(raster).toBeInstanceOf(HTMLCanvasElement);
    expect(raster.width).toBe(3);
    expect(raster.height).toBe(3);
  });

  it('uses state.raster directly when provided instead of rebuilding', () => {
    const customRaster = buildFogRaster(3, 3, false, new Set([0]));
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: new Set([0]),
      revealOpacity: new Map(),
      raster: customRaster,
    }, viewport3x3);

    const drawCall = mainCtx.calls.find((c) => c.method === 'drawImage');
    expect(drawCall?.args[0]).toBe(customRaster);
  });

  it('does nothing when state.revealedCells is null', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: null,
      revealOpacity: new Map(),
    }, viewport3x3);

    expect(mainCtx.calls).toHaveLength(0);
  });

  it('does nothing when mapWidth or mapHeight <= 0', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: new Set([0]),
      revealOpacity: new Map(),
    }, { ...viewport3x3, mapWidth: 0 });

    expect(mainCtx.calls).toHaveLength(0);
  });
});

describe('drawFog compositing fidelity', () => {
  it('clears exemptCells to transparent on composite raster for player', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: new Set([0]),
      exemptCells: new Set([4]), // center cell exempt
      revealOpacity: new Map(),
    }, viewport3x3);

    const drawCall = mainCtx.calls.find((c) => c.method === 'drawImage');
    const finalRaster = drawCall?.args[0] as HTMLCanvasElement;
    const data = getMockOffscreenContext(finalRaster).getImageData(0, 0, 3, 3).data;

    // Cell 0 (revealed): transparent
    expect(Array.from(data.slice(0, 4))).toEqual([0, 0, 0, 0]);
    // Cell 1 (unrevealed): player fog color
    expect(Array.from(data.slice(4, 8))).toEqual([15, 12, 25, 255]);
    // Cell 4 (exempt): transparent
    expect(Array.from(data.slice(4 * 4, 4 * 4 + 4))).toEqual([0, 0, 0, 0]);
  });

  it('applies revealOpacity transition fade on composite raster for player', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: new Set([0]),
      revealOpacity: new Map([[1, 0.4]]),
    }, viewport3x3);

    const drawCall = mainCtx.calls.find((c) => c.method === 'drawImage');
    const finalRaster = drawCall?.args[0] as HTMLCanvasElement;
    const data = getMockOffscreenContext(finalRaster).getImageData(0, 0, 3, 3).data;

    const cell1Rgba = Array.from(data.slice(4, 8));
    expect(cell1Rgba[0]).toBe(15);
    expect(cell1Rgba[1]).toBe(12);
    expect(cell1Rgba[2]).toBe(25);
    expect(cell1Rgba[3]).toBe(102); // 255 * 0.4
  });

  it('applies revealOpacity transition fade for DM view', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: true,
      fogState: dmFogState3x3,
      revealedCells: null,
      revealOpacity: new Map([[1, 0.5]]),
    }, viewport3x3);

    const drawCall = mainCtx.calls.find((c) => c.method === 'drawImage');
    const finalRaster = drawCall?.args[0] as HTMLCanvasElement;
    const data = getMockOffscreenContext(finalRaster).getImageData(0, 0, 3, 3).data;

    const cell1Rgba = Array.from(data.slice(4, 8));
    expect(cell1Rgba[0]).toBe(15);
    expect(cell1Rgba[1]).toBe(12);
    expect(cell1Rgba[2]).toBe(25);
    expect(cell1Rgba[3]).toBe(70); // 140 * 0.5
  });

  it('prioritizes exemptCells over revealOpacity when cell is present in both', () => {
    const mainCtx = makeMainCtx();
    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: new Set(),
      exemptCells: new Set([2]),
      revealOpacity: new Map([[2, 0.9]]),
    }, viewport3x3);

    const drawCall = mainCtx.calls.find((c) => c.method === 'drawImage');
    const finalRaster = drawCall?.args[0] as HTMLCanvasElement;
    const data = getMockOffscreenContext(finalRaster).getImageData(0, 0, 3, 3).data;

    expect(Array.from(data.slice(2 * 4, 2 * 4 + 4))).toEqual([0, 0, 0, 0]);
  });

  it('passes baseRaster directly to drawImage when no exemptCells or revealOpacity are present', () => {
    const customRaster = document.createElement('canvas');
    customRaster.width = 3;
    customRaster.height = 3;
    const mainCtx = makeMainCtx();

    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: new Set([0]),
      revealOpacity: new Map(),
      raster: customRaster,
    }, viewport3x3);

    const drawCall = mainCtx.calls.find((c) => c.method === 'drawImage');
    expect(drawCall?.args[0]).toBe(customRaster);
  });

  it('reuses provided scratchCanvas during dynamic compositing', () => {
    const scratchCanvas = document.createElement('canvas');
    const mainCtx = makeMainCtx();

    drawFog(mainCtx, {
      isDM: false,
      fogState: null,
      revealedCells: new Set([0]),
      exemptCells: new Set([2]),
      revealOpacity: new Map(),
      scratchCanvas,
    }, viewport3x3);

    const drawCall = mainCtx.calls.find((c) => c.method === 'drawImage');
    expect(drawCall?.args[0]).toBe(scratchCanvas);
  });
});
