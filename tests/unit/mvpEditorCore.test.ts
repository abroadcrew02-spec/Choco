/**
 * Unit tests for MvpEditor core pure functions.
 *
 * Covers:
 * - compositeRegions: simplified (no layer args), color / transparent regions
 * - floodFillSelect: uniform fill, boundary, color boundary
 * - isAcceptedImageFile: MIME type and extension fallback (C-2 fix)
 * - UndoRedo state machine: history limit 10, undo/redo chains
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  compositeRegions,
  floodFillSelect,
  isAcceptedImageFile,
  hexToRgb,
  rgbToHex,
  replaceAllSelect,
  pickPixelColor,
  extractPaletteColors,
  smoothReplaceAll,
  closeMask,
  blurMask,
  removeCollinear,
  simplifyPath,
  normalizeBbox,
  type PaintRegion,
} from "../../src/components/MvpEditor/MvpEditor";
import { hsv2rgb, rgb2hsv } from "../../src/components/MvpEditor/components/HsvPicker";

// jsdom does not implement ImageData. Provide a minimal polyfill.
beforeAll(() => {
  if (typeof ImageData === "undefined") {
    // @ts-expect-error polyfill for jsdom
    globalThis.ImageData = class ImageData {
      width: number;
      height: number;
      data: Uint8ClampedArray;
      constructor(
        dataOrWidth: Uint8ClampedArray | number,
        widthOrHeight: number,
        height?: number
      ) {
        if (dataOrWidth instanceof Uint8ClampedArray) {
          this.data = dataOrWidth;
          this.width = widthOrHeight;
          this.height = height!;
        } else {
          this.width = dataOrWidth;
          this.height = widthOrHeight;
          this.data = new Uint8ClampedArray(dataOrWidth * widthOrHeight * 4);
        }
      }
    };
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSolidImageData(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a = 255
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return new ImageData(data, width, height);
}

// ---------------------------------------------------------------------------
// hexToRgb
// ---------------------------------------------------------------------------

describe("hexToRgb", () => {
  it("parses red", () => {
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
  });
  it("parses white", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
  });
  it("returns [0,0,0] for invalid input", () => {
    expect(hexToRgb("invalid")).toEqual([0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// compositeRegions (no layer args — simplified API)
// ---------------------------------------------------------------------------

describe("compositeRegions", () => {
  it("returns base image unchanged when regions is empty", () => {
    const base = makeSolidImageData(2, 2, 100, 150, 200);
    const result = compositeRegions(base, []);
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(150);
    expect(result.data[2]).toBe(200);
    expect(result.data[3]).toBe(255);
  });

  it("does not mutate the base ImageData", () => {
    const base = makeSolidImageData(2, 2, 50, 50, 50);
    const originalData = base.data.slice();
    compositeRegions(base, [
      { id: "r1", pixels: [{ x: 0, y: 0 }], color: "#ff0000", transparent: false },
    ]);
    expect(base.data).toEqual(originalData);
  });

  it("applies a color region on top of the background", () => {
    const base = makeSolidImageData(4, 4, 0, 0, 0);
    const region: PaintRegion = {
      id: "r1",
      pixels: [{ x: 0, y: 0 }],
      color: "#ff0000",
      transparent: false,
    };
    const result = compositeRegions(base, [region]);
    expect(result.data[0]).toBe(255); // R
    expect(result.data[1]).toBe(0);   // G
    expect(result.data[2]).toBe(0);   // B
    expect(result.data[3]).toBe(255); // A
  });

  it("transparent region sets alpha=0 on specified pixels", () => {
    const base = makeSolidImageData(4, 4, 200, 200, 200);
    const region: PaintRegion = {
      id: "r-trans",
      pixels: [{ x: 1, y: 1 }],
      color: "#000000",
      transparent: true,
    };
    const result = compositeRegions(base, [region]);
    const idx = (1 * 4 + 1) * 4;
    expect(result.data[idx + 3]).toBe(0);
    // Other pixels unaffected
    expect(result.data[3]).toBe(255);
  });

  it("multiple regions applied in order", () => {
    const base = makeSolidImageData(2, 2, 0, 0, 0);
    const r1: PaintRegion = { id: "r1", pixels: [{ x: 0, y: 0 }], color: "#0000ff", transparent: false };
    const r2: PaintRegion = { id: "r2", pixels: [{ x: 0, y: 0 }], color: "#00ff00", transparent: false };
    const result = compositeRegions(base, [r1, r2]);
    // r2 overwrites r1 at (0,0)
    expect(result.data[0]).toBe(0);   // R
    expect(result.data[1]).toBe(255); // G
    expect(result.data[2]).toBe(0);   // B
  });
});

// ---------------------------------------------------------------------------
// floodFillSelect
// ---------------------------------------------------------------------------

describe("floodFillSelect", () => {
  it("selects all pixels in a 1x1 image", () => {
    const base = makeSolidImageData(1, 1, 100, 100, 100);
    const result = floodFillSelect(base, 0, 0, 0);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ x: 0, y: 0 });
  });

  it("selects the entire uniform image with tolerance=0", () => {
    const base = makeSolidImageData(4, 4, 200, 100, 50);
    const result = floodFillSelect(base, 0, 0, 0);
    expect(result).toHaveLength(16);
  });

  it("does not cross a sharp color boundary with tolerance=0", () => {
    const data = new Uint8ClampedArray(4 * 2 * 4);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        if (x < 2) {
          data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
        } else {
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 255; data[i + 3] = 255;
        }
      }
    }
    const imageData = new ImageData(data, 4, 2);
    const result = floodFillSelect(imageData, 0, 0, 0);
    expect(result).toHaveLength(4);
    for (const p of result) {
      expect(p.x).toBeLessThan(2);
    }
  });

  it("all-transparent image: flood fill propagates by RGB (not alpha)", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    const imageData = new ImageData(data, 4, 4);
    const result = floodFillSelect(imageData, 0, 0, 0);
    expect(result).toHaveLength(16);
  });
});

// ---------------------------------------------------------------------------
// isAcceptedImageFile (C-2 fix: extension fallback for WebView2)
// ---------------------------------------------------------------------------

describe("isAcceptedImageFile", () => {
  it("accepts PNG by MIME type", () => {
    expect(isAcceptedImageFile({ type: "image/png", name: "test.png" })).toBe(true);
  });

  it("accepts JPEG by MIME type", () => {
    expect(isAcceptedImageFile({ type: "image/jpeg", name: "photo.jpg" })).toBe(true);
  });

  it("accepts SVG by MIME type", () => {
    expect(isAcceptedImageFile({ type: "image/svg+xml", name: "icon.svg" })).toBe(true);
  });

  it("accepts PNG by extension when MIME type is empty (WebView2 DnD)", () => {
    expect(isAcceptedImageFile({ type: "", name: "photo.png" })).toBe(true);
  });

  it("accepts JPG by extension when MIME type is empty", () => {
    expect(isAcceptedImageFile({ type: "", name: "photo.jpg" })).toBe(true);
  });

  it("accepts JPEG by extension when MIME type is empty", () => {
    expect(isAcceptedImageFile({ type: "", name: "photo.jpeg" })).toBe(true);
  });

  it("accepts SVG by extension when MIME type is empty", () => {
    expect(isAcceptedImageFile({ type: "", name: "graphic.svg" })).toBe(true);
    expect(isAcceptedImageFile({ type: "", name: "ICON.SVG" })).toBe(true);
  });

  it("accepts WebP by extension", () => {
    expect(isAcceptedImageFile({ type: "", name: "image.webp" })).toBe(true);
  });

  it("rejects non-image files", () => {
    expect(isAcceptedImageFile({ type: "application/pdf", name: "doc.pdf" })).toBe(false);
    expect(isAcceptedImageFile({ type: "text/plain", name: "note.txt" })).toBe(false);
    expect(isAcceptedImageFile({ type: "", name: "unknown" })).toBe(false);
    expect(isAcceptedImageFile({ type: "", name: "file.exe" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UndoRedo state machine (mirrors useUndoRedo logic, history limit = 10)
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 10;

interface UndoRedoState<T> {
  history: T[];
  index: number;
}

function makeState<T>(initial: T): UndoRedoState<T> {
  return { history: [initial], index: 0 };
}

function urPush<T>(state: UndoRedoState<T>, next: T): UndoRedoState<T> {
  const truncated = state.history.slice(0, state.index + 1);
  const newHistory = [...truncated, next];
  const sliced =
    newHistory.length > HISTORY_LIMIT
      ? newHistory.slice(newHistory.length - HISTORY_LIMIT)
      : newHistory;
  return { history: sliced, index: sliced.length - 1 };
}

function urUndo<T>(state: UndoRedoState<T>): UndoRedoState<T> {
  return state.index > 0 ? { ...state, index: state.index - 1 } : state;
}

function urRedo<T>(state: UndoRedoState<T>): UndoRedoState<T> {
  return state.index < state.history.length - 1
    ? { ...state, index: state.index + 1 }
    : state;
}

function urCurrent<T>(state: UndoRedoState<T>): T {
  return state.history[state.index];
}

describe("UndoRedo state machine (history limit = 10)", () => {
  it("starts with initial value", () => {
    const s = makeState<number[]>([]);
    expect(urCurrent(s)).toEqual([]);
    expect(s.index > 0).toBe(false);
  });

  it("push enables undo", () => {
    let s = makeState<number>(0);
    s = urPush(s, 1);
    expect(urCurrent(s)).toBe(1);
    expect(s.index > 0).toBe(true);
    expect(s.index < s.history.length - 1).toBe(false);
  });

  it("undo/redo round-trip", () => {
    let s = makeState<string>("a");
    s = urPush(s, "b");
    s = urPush(s, "c");
    s = urUndo(s);
    expect(urCurrent(s)).toBe("b");
    s = urRedo(s);
    expect(urCurrent(s)).toBe("c");
  });

  it("push after undo discards redo branch", () => {
    let s = makeState<number>(0);
    s = urPush(s, 1);
    s = urPush(s, 2);
    s = urUndo(s);
    s = urPush(s, 99);
    expect(urCurrent(s)).toBe(99);
    expect(s.index < s.history.length - 1).toBe(false);
  });

  it("history is capped at 10 entries; oldest is dropped", () => {
    let s = makeState<number>(0);
    for (let i = 1; i <= 14; i++) {
      s = urPush(s, i);
    }
    expect(urCurrent(s)).toBe(14);
    expect(s.history.length).toBe(HISTORY_LIMIT);

    // Undo to start
    for (let i = 0; i < 9; i++) {
      s = urUndo(s);
    }
    expect(s.index > 0).toBe(false);
    // Oldest retained: initial(0) + 14 pushes = 15, sliced to 10 → first kept is value 5
    expect(urCurrent(s)).toBe(5);
  });

  it("undo beyond start is a no-op", () => {
    let s = makeState<number>(42);
    s = urUndo(s);
    s = urUndo(s);
    expect(urCurrent(s)).toBe(42);
  });

  it("redo beyond end is a no-op", () => {
    let s = makeState<number>(1);
    s = urPush(s, 2);
    s = urRedo(s);
    s = urRedo(s);
    expect(urCurrent(s)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// rgbToHex
// ---------------------------------------------------------------------------

describe("rgbToHex", () => {
  it("converts pure red", () => {
    expect(rgbToHex(255, 0, 0)).toBe("#ff0000");
  });
  it("converts pure white", () => {
    expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
  });
  it("converts black", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
  });
  it("hexToRgb and rgbToHex are inverse", () => {
    const [r, g, b] = hexToRgb("#1a2b3c");
    expect(rgbToHex(r, g, b)).toBe("#1a2b3c");
  });
});

// ---------------------------------------------------------------------------
// pickPixelColor
// ---------------------------------------------------------------------------

describe("pickPixelColor", () => {
  it("returns correct RGB for a solid image", () => {
    const img = makeSolidImageData(3, 3, 100, 150, 200);
    expect(pickPixelColor(img, 1, 1)).toEqual([100, 150, 200]);
  });
  it("returns null for out-of-bounds coordinates", () => {
    const img = makeSolidImageData(2, 2, 0, 0, 0);
    expect(pickPixelColor(img, -1, 0)).toBeNull();
    expect(pickPixelColor(img, 0, 5)).toBeNull();
    expect(pickPixelColor(img, 2, 0)).toBeNull();
  });
  it("returns pixel at (0,0) correctly", () => {
    const img = makeSolidImageData(1, 1, 255, 128, 64);
    expect(pickPixelColor(img, 0, 0)).toEqual([255, 128, 64]);
  });
});

// ---------------------------------------------------------------------------
// replaceAllSelect
// ---------------------------------------------------------------------------

describe("replaceAllSelect", () => {
  it("selects all pixels in a uniform image", () => {
    const img = makeSolidImageData(4, 4, 200, 100, 50);
    const result = replaceAllSelect(img, 0, 0, 0);
    expect(result).toHaveLength(16);
  });

  it("selects only matching pixels across non-adjacent regions", () => {
    // 4x2: left 2 cols = red, right 2 cols = blue
    const data = new Uint8ClampedArray(4 * 2 * 4);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        if (x < 2) {
          data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
        } else {
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 255; data[i + 3] = 255;
        }
      }
    }
    const img = new ImageData(data, 4, 2);
    const reds = replaceAllSelect(img, 0, 0, 0);
    expect(reds).toHaveLength(4);
    for (const p of reds) expect(p.x).toBeLessThan(2);

    const blues = replaceAllSelect(img, 2, 0, 0);
    expect(blues).toHaveLength(4);
    for (const p of blues) expect(p.x).toBeGreaterThanOrEqual(2);
  });

  it("respects tolerance and includes near-match pixels", () => {
    // pixel (0,0)=255,0,0 and pixel (1,0)=250,0,0 — distance=5
    const data = new Uint8ClampedArray(2 * 1 * 4);
    data[0] = 255; data[1] = 0; data[2] = 0; data[3] = 255;
    data[4] = 250; data[5] = 0; data[6] = 0; data[7] = 255;
    const img = new ImageData(data, 2, 1);
    expect(replaceAllSelect(img, 0, 0, 0)).toHaveLength(1);
    expect(replaceAllSelect(img, 0, 0, 10)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// extractPaletteColors
// ---------------------------------------------------------------------------

describe("extractPaletteColors", () => {
  it("returns at most count colors", () => {
    const img = makeSolidImageData(4, 4, 100, 100, 100);
    const palette = extractPaletteColors(img, 8);
    expect(palette.length).toBeLessThanOrEqual(8);
  });

  it("returns hex strings in lowercase #rrggbb format", () => {
    const img = makeSolidImageData(2, 2, 255, 0, 0);
    const palette = extractPaletteColors(img, 4);
    expect(palette.length).toBeGreaterThan(0);
    for (const hex of palette) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("skips mostly-transparent pixels", () => {
    // All pixels have alpha=0, should yield empty palette
    const data = new Uint8ClampedArray(4 * 4 * 4);
    // data is all zeros (alpha=0)
    const img = new ImageData(data, 4, 4);
    const palette = extractPaletteColors(img, 8);
    expect(palette).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// compositeRegions with bakeLayer (S1: bake layer compositing)
// ---------------------------------------------------------------------------

describe("compositeRegions with bakeLayer", () => {
  it("bakeLayer=null produces same result as no bakeLayer (backward compat)", () => {
    const base = makeSolidImageData(2, 2, 100, 150, 200);
    const r1: PaintRegion = { id: "r1", pixels: [{ x: 0, y: 0 }], color: "#ff0000", transparent: false };
    const withNull = compositeRegions(base, [r1], null);
    const withoutArg = compositeRegions(base, [r1]);
    expect(withNull.data).toEqual(withoutArg.data);
  });

  it("fully opaque bakeLayer pixel overwrites composited region pixel", () => {
    const base = makeSolidImageData(2, 2, 0, 0, 0);
    const bakeData = new Uint8ClampedArray(2 * 2 * 4);
    // pixel (0,0) fully opaque blue
    bakeData[0] = 0; bakeData[1] = 0; bakeData[2] = 255; bakeData[3] = 255;
    const bake = new ImageData(bakeData, 2, 2);
    const result = compositeRegions(base, [], bake);
    expect(result.data[0]).toBe(0);   // R
    expect(result.data[1]).toBe(0);   // G
    expect(result.data[2]).toBe(255); // B
    expect(result.data[3]).toBe(255); // A
  });

  it("transparent bakeLayer pixels do not affect composited result", () => {
    const base = makeSolidImageData(2, 2, 100, 150, 200);
    // all-transparent bakeLayer
    const bakeData = new Uint8ClampedArray(2 * 2 * 4);
    const bake = new ImageData(bakeData, 2, 2);
    const result = compositeRegions(base, [], bake);
    expect(result.data[0]).toBe(100);
    expect(result.data[1]).toBe(150);
    expect(result.data[2]).toBe(200);
  });

  it("bakeLayer is composited on top of regions", () => {
    const base = makeSolidImageData(2, 2, 0, 0, 0);
    // region paints (0,0) red
    const region: PaintRegion = { id: "r1", pixels: [{ x: 0, y: 0 }], color: "#ff0000", transparent: false };
    // bakeLayer paints (0,0) green (fully opaque) — should win
    const bakeData = new Uint8ClampedArray(2 * 2 * 4);
    bakeData[0] = 0; bakeData[1] = 255; bakeData[2] = 0; bakeData[3] = 255;
    const bake = new ImageData(bakeData, 2, 2);
    const result = compositeRegions(base, [region], bake);
    expect(result.data[0]).toBe(0);   // R overwritten by bake
    expect(result.data[1]).toBe(255); // G from bake
    expect(result.data[2]).toBe(0);   // B
  });
});

// ---------------------------------------------------------------------------
// smoothReplaceAll (S1: smooth color replacement)
// ---------------------------------------------------------------------------

describe("smoothReplaceAll", () => {
  it("hard replace: replaces all matching pixels within tolerance exactly", () => {
    const base = makeSolidImageData(4, 4, 200, 100, 50);
    const result = smoothReplaceAll(base, 0, 0, 0, [0, 255, 0], false);
    // All pixels match exactly (tolerance=0), should all be replaced
    for (let i = 0; i < 16; i++) {
      expect(result.data[i * 4]).toBe(0);
      expect(result.data[i * 4 + 1]).toBe(255);
      expect(result.data[i * 4 + 2]).toBe(0);
    }
  });

  it("hard replace: does not replace pixels outside tolerance", () => {
    // 2x1: left=red, right=blue
    const data = new Uint8ClampedArray(2 * 1 * 4);
    data[0] = 255; data[1] = 0; data[2] = 0; data[3] = 255;
    data[4] = 0;   data[5] = 0; data[6] = 255; data[7] = 255;
    const img = new ImageData(data, 2, 1);
    const result = smoothReplaceAll(img, 0, 0, 0, [0, 255, 0], false);
    // Left pixel replaced
    expect(result.data[0]).toBe(0);
    expect(result.data[1]).toBe(255);
    // Right pixel untouched
    expect(result.data[4]).toBe(0);
    expect(result.data[5]).toBe(0);
    expect(result.data[6]).toBe(255);
  });

  it("smooth replace: center pixel (dist=0) gets blend factor 1.0 and is fully replaced", () => {
    const base = makeSolidImageData(1, 1, 200, 100, 50);
    const result = smoothReplaceAll(base, 0, 0, 30, [0, 255, 0], true);
    // dist2=0, a=1-0/(30*2)=1 → fully replaced
    expect(result.data[0]).toBe(0);
    expect(result.data[1]).toBe(255);
    expect(result.data[2]).toBe(0);
  });

  it("smooth replace: pixel at boundary gets partial blend", () => {
    // Two pixels: (0,0)=200,100,50  (1,0)=210,100,50 — dist=10 < tol=30
    const data = new Uint8ClampedArray(2 * 1 * 4);
    data[0] = 200; data[1] = 100; data[2] = 50; data[3] = 255;
    data[4] = 210; data[5] = 100; data[6] = 50; data[7] = 255;
    const img = new ImageData(data, 2, 1);
    const result = smoothReplaceAll(img, 0, 0, 30, [0, 255, 0], true);
    // (1,0) should be partially blended (not fully replaced)
    // a = 1 - 10 / 60 ≈ 0.833, so R should be between 0 and 210
    expect(result.data[4]).toBeGreaterThan(0);
    expect(result.data[4]).toBeLessThan(210);
    expect(result.data[5]).toBeGreaterThan(100); // blended toward 255
  });

  it("does not mutate the input ImageData", () => {
    const base = makeSolidImageData(2, 2, 200, 100, 50);
    const originalSlice = base.data.slice();
    smoothReplaceAll(base, 0, 0, 30, [0, 255, 0], true);
    expect(base.data).toEqual(originalSlice);
  });
});

// ---------------------------------------------------------------------------
// S2: hsv2rgb / rgb2hsv round-trip
// ---------------------------------------------------------------------------

describe("hsv2rgb", () => {
  it("converts pure red (h=0, s=1, v=1) to rgb(255,0,0)", () => {
    const result = hsv2rgb(0, 1, 1);
    expect(result.r).toBe(255);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it("converts pure green (h=120, s=1, v=1) to rgb(0,255,0)", () => {
    const result = hsv2rgb(120, 1, 1);
    expect(result.r).toBe(0);
    expect(result.g).toBe(255);
    expect(result.b).toBe(0);
  });

  it("converts pure blue (h=240, s=1, v=1) to rgb(0,0,255)", () => {
    const result = hsv2rgb(240, 1, 1);
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(255);
  });

  it("converts black (v=0) to rgb(0,0,0)", () => {
    const result = hsv2rgb(0, 0, 0);
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it("converts white (s=0, v=1) to rgb(255,255,255)", () => {
    const result = hsv2rgb(0, 0, 1);
    expect(result.r).toBe(255);
    expect(result.g).toBe(255);
    expect(result.b).toBe(255);
  });
});

describe("rgb2hsv", () => {
  it("converts rgb(255,0,0) to h=0, s=1, v=1", () => {
    const result = rgb2hsv(255, 0, 0);
    expect(result.h).toBeCloseTo(0, 1);
    expect(result.s).toBeCloseTo(1, 3);
    expect(result.v).toBeCloseTo(1, 3);
  });

  it("converts rgb(0,0,0) to v=0", () => {
    const result = rgb2hsv(0, 0, 0);
    expect(result.v).toBeCloseTo(0, 3);
  });

  it("converts rgb(255,255,255) to s=0, v=1", () => {
    const result = rgb2hsv(255, 255, 255);
    expect(result.s).toBeCloseTo(0, 3);
    expect(result.v).toBeCloseTo(1, 3);
  });
});

// ---------------------------------------------------------------------------
// removeCollinear
// ---------------------------------------------------------------------------

describe("removeCollinear", () => {
  it("keeps endpoints and corner points, removes collinear intermediates", () => {
    // Horizontal run: (0,0)→(1,0)→(2,0)→(3,0) — middle two are collinear
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    const result = removeCollinear(pts);
    expect(result).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }]);
  });

  it("keeps all points when each is a corner", () => {
    // L-shape: right then down — every interior point is a corner
    const pts = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
    ];
    const result = removeCollinear(pts);
    expect(result).toEqual(pts);
  });

  it("returns input unchanged for 2 or fewer points", () => {
    expect(removeCollinear([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toHaveLength(2);
    expect(removeCollinear([{ x: 0, y: 0 }])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// simplifyPath (Douglas-Peucker)
// ---------------------------------------------------------------------------

describe("simplifyPath", () => {
  it("collapses a nearly-straight run to two endpoints", () => {
    // Five points along a slightly wobbly horizontal line (max deviation 0.3)
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0.1 },
      { x: 2, y: 0.3 },
      { x: 3, y: 0.1 },
      { x: 4, y: 0 },
    ];
    const result = simplifyPath(pts, 0.5);
    expect(result).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }]);
  });

  it("preserves a sharp corner under tight epsilon", () => {
    // Right angle: (0,0)→(5,0)→(5,5). Corner is 5px away from diagonal.
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ];
    const result = simplifyPath(pts, 0.5);
    // All three points should be kept
    expect(result).toHaveLength(3);
  });

  it("returns input unchanged for 2 or fewer points", () => {
    expect(simplifyPath([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.5)).toHaveLength(2);
    expect(simplifyPath([{ x: 0, y: 0 }], 0.5)).toHaveLength(1);
  });
});

describe("hsv2rgb / rgb2hsv round-trip", () => {
  it("round-trips a saturated color without precision loss", () => {
    const original = { h: 200, s: 0.8, v: 0.9 };
    const { r, g, b } = hsv2rgb(original.h, original.s, original.v);
    const back = rgb2hsv(r, g, b);
    expect(back.h).toBeCloseTo(original.h, 0);
    expect(back.s).toBeCloseTo(original.s, 1);
    expect(back.v).toBeCloseTo(original.v, 1);
  });
});

// ---------------------------------------------------------------------------
// S2: closeMask (hole-fill morphological closing)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// S3: blurMask (2-pass box blur)
// ---------------------------------------------------------------------------

describe("blurMask", () => {
  it("returns input unchanged when radius=0", () => {
    const src = new Float32Array([0, 1, 0, 1, 0, 1, 0, 1, 0]);
    const result = blurMask(src, 3, 3, 0);
    for (let i = 0; i < src.length; i++) {
      expect(result[i]).toBeCloseTo(src[i], 5);
    }
  });

  it("output length matches width*height", () => {
    const src = new Float32Array(4 * 4).fill(1);
    const result = blurMask(src, 4, 4, 2);
    expect(result.length).toBe(16);
  });

  it("uniform all-1 mask stays ~1.0 after blurring (area average preserving)", () => {
    const w = 8, h = 8;
    const src = new Float32Array(w * h).fill(1);
    const result = blurMask(src, w, h, 2);
    // Interior pixels of a uniform field should still be ~1 after box blur
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        expect(result[y * w + x]).toBeCloseTo(1, 2);
      }
    }
  });

  it("single hot-pixel mask is blurred outward (center value decreases, neighbors increase)", () => {
    const w = 5, h = 5;
    const src = new Float32Array(w * h);
    src[2 * w + 2] = 1; // center only
    const result = blurMask(src, w, h, 1);
    // Center should be less than 1 (spread to neighbors)
    expect(result[2 * w + 2]).toBeLessThan(1);
    // At least one neighbor should have gained value
    const neighborSum =
      result[1 * w + 2] + result[3 * w + 2] +
      result[2 * w + 1] + result[2 * w + 3];
    expect(neighborSum).toBeGreaterThan(0);
  });
});

describe("closeMask", () => {
  it("returns input unchanged when radius=0", () => {
    const pixels = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const result = closeMask(pixels, 4, 4, 0);
    expect(result).toEqual(pixels);
  });

  it("returns empty array unchanged when pixels is empty", () => {
    const result = closeMask([], 4, 4, 1);
    expect(result).toEqual([]);
  });

  it("fills a 1-pixel hole surrounded by selected pixels", () => {
    // 3x3 image: all selected except center (1,1)
    const pixels: { x: number; y: number }[] = [];
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        if (!(x === 1 && y === 1)) pixels.push({ x, y });
      }
    }
    // radius=1 dilation should fill the hole, then erosion keeps the interior
    const result = closeMask(pixels, 3, 3, 1);
    const resultSet = new Set(result.map((p) => `${p.x},${p.y}`));
    // Center pixel (1,1) should now be included
    expect(resultSet.has("1,1")).toBe(true);
  });

  it("does not expand a filled region outward after closing", () => {
    // Single center pixel of a 5x5 image — closing should not grow it
    const pixels = [{ x: 2, y: 2 }];
    const result = closeMask(pixels, 5, 5, 1);
    // After dilate then erode, isolated single pixel shrinks to nothing
    expect(result.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// S5+S6: normalizeBbox (shape bounding-box helper)
// ---------------------------------------------------------------------------

describe("normalizeBbox", () => {
  it("returns correct bbox when drag goes top-left to bottom-right", () => {
    const r = normalizeBbox(10, 20, 50, 80);
    expect(r).toEqual({ x: 10, y: 20, w: 40, h: 60 });
  });

  it("normalizes reversed coordinates (drag bottom-right to top-left)", () => {
    const r = normalizeBbox(50, 80, 10, 20);
    expect(r).toEqual({ x: 10, y: 20, w: 40, h: 60 });
  });

  it("returns zero dimensions for single-point drag", () => {
    const r = normalizeBbox(30, 30, 30, 30);
    expect(r).toEqual({ x: 30, y: 30, w: 0, h: 0 });
  });

  it("handles negative-direction drags correctly", () => {
    const r = normalizeBbox(100, 200, 40, 50);
    expect(r.x).toBe(40);
    expect(r.y).toBe(50);
    expect(r.w).toBe(60);
    expect(r.h).toBe(150);
  });

  it("produces same result regardless of drag direction", () => {
    const a = normalizeBbox(5, 10, 25, 40);
    const b = normalizeBbox(25, 40, 5, 10);
    expect(a).toEqual(b);
  });
});
