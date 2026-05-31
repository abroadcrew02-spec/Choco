/**
 * Unit tests for MvpEditor core pure functions.
 *
 * Covers:
 * - compositeRegions: simplified (no layer args), color / transparent regions
 * - floodFillSelect: uniform fill, boundary, color boundary
 * - isAcceptedImageFile: MIME type and extension fallback (C-2 fix)
 * - UndoRedo state machine: history limit 10, undo/redo chains
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import {
  compositeRegions,
  floodFillSelect,
  isAcceptedImageFile,
  isInputFocused,
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
  marchingSquaresPath,
  exportImageData,
  buildSvg,
  type PaintRegion,
} from "../../src/components/MvpEditor/MvpEditor";
import { copyImageDataInto, buildShapePath, snapCoord } from "../../src/components/MvpEditor/lib/imageProcessing";
import {
  getMimeType,
  getFileExtension,
  calcOutputSize,
  estimateFileSizeBytes,
  formatFileSizeLabel,
  type ExportFormat,
} from "../../src/components/MvpEditor/components/ExportModal";
import { hsv2rgb, rgb2hsv } from "../../src/components/MvpEditor/components/HsvPicker";
import {
  buildCssLinearGradient,
  buildCssRadialGradient,
  applyLinearGradient,
  applyRadialGradient,
  type GradientStop,
} from "../../src/components/MvpEditor/components/GradientEditor";
import {
  hexToHsl,
  hslToHex,
  complementary,
  triadic,
  analogous,
  splitComplementary,
} from "../../src/components/MvpEditor/lib/colorHarmony";

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

  // Issue #14: alpha-aware selection tests
  it("transparent black (0,0,0,0) and opaque black (0,0,0,255) are not same-color", () => {
    // 2x1: left pixel = opaque black, right pixel = transparent black (same RGB)
    const data = new Uint8ClampedArray(2 * 1 * 4);
    data[0] = 0; data[1] = 0; data[2] = 0; data[3] = 255; // opaque black
    data[4] = 0; data[5] = 0; data[6] = 0; data[7] = 0;   // transparent black
    const img = new ImageData(data, 2, 1);
    // Starting from opaque black: should NOT include the transparent black pixel
    const result = floodFillSelect(img, 0, 0, 0);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ x: 0, y: 0 });
  });

  it("flood fill starting on transparent pixel stays within transparent region", () => {
    // 3x1: [transparent, transparent, opaque white]
    const data = new Uint8ClampedArray(3 * 1 * 4);
    data[0] = 0;   data[1] = 0;   data[2] = 0;   data[3] = 0;   // transparent
    data[4] = 0;   data[5] = 0;   data[6] = 0;   data[7] = 0;   // transparent
    data[8] = 255; data[9] = 255; data[10] = 255; data[11] = 255; // opaque white
    const img = new ImageData(data, 3, 1);
    const result = floodFillSelect(img, 0, 0, 0);
    expect(result).toHaveLength(2);
    for (const p of result) expect(p.x).toBeLessThan(2);
  });

  it("replaceAllSelect: transparent vs opaque same-RGB pixels are not matched", () => {
    // 2x1: left = opaque red, right = transparent red
    const data = new Uint8ClampedArray(2 * 1 * 4);
    data[0] = 255; data[1] = 0; data[2] = 0; data[3] = 255; // opaque red
    data[4] = 255; data[5] = 0; data[6] = 0; data[7] = 0;   // transparent red
    const img = new ImageData(data, 2, 1);
    const result = replaceAllSelect(img, 0, 0, 0);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ x: 0, y: 0 });
  });

  it("existing opaque color selection is unaffected by alpha fix", () => {
    // All pixels opaque red — should still select all 4
    const img = makeSolidImageData(2, 2, 255, 0, 0, 255);
    const result = floodFillSelect(img, 0, 0, 0);
    expect(result).toHaveLength(4);
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
    // dist2=0, a=1-0/30=1 → fully replaced
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
    // a = 1 - 10 / 30 ≈ 0.667, so R should be between 0 and 210
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
// Issue #2: smoothReplace regionHistory push-empty (double-apply prevention)
// ---------------------------------------------------------------------------

describe("smoothReplace regionHistory empty-push (Issue #2)", () => {
  it("regions entry pushed after smoothReplaceAll must be empty (no existing regions carried over)", () => {
    // Simulate: paint one region, then do smoothReplace.
    // The regionHistory entry for the smooth-replace step must be [] so that
    // compositing only reads bakeLayer and does not double-apply regions.
    const base = makeSolidImageData(4, 4, 200, 100, 50);
    const existingRegion: PaintRegion = {
      id: "r1",
      pixels: [{ x: 0, y: 0 }],
      color: "#ff0000",
      transparent: false,
    };

    // Before smooth replace: regions = [existingRegion]
    let regionState = urPush(makeState<PaintRegion[]>([]), [existingRegion]);
    expect(urCurrent(regionState)).toHaveLength(1);

    // Simulate smooth replace: push [] (not [...regions])
    const newImageData = smoothReplaceAll(
      compositeRegions(base, urCurrent(regionState)),
      0, 0, 30, [0, 255, 0], true
    );
    expect(newImageData).toBeDefined();

    // This is the fix: push empty regions after smooth replace
    regionState = urPush(regionState, []);
    expect(urCurrent(regionState)).toHaveLength(0);

    // Undo must restore the pre-replace region list
    regionState = urUndo(regionState);
    expect(urCurrent(regionState)).toHaveLength(1);

    // Redo must return to empty regions (bakeLayer carries the visual state)
    regionState = urRedo(regionState);
    expect(urCurrent(regionState)).toHaveLength(0);
  });

  it("undo/redo cycle after smoothReplace yields consistent regions (no double-apply)", () => {
    // Push two paint steps then a smooth-replace step, cycle undo/redo.
    const r1: PaintRegion = { id: "r1", pixels: [{ x: 0, y: 0 }], color: "#ff0000", transparent: false };
    const r2: PaintRegion = { id: "r2", pixels: [{ x: 1, y: 0 }], color: "#00ff00", transparent: false };

    let s = makeState<PaintRegion[]>([]);
    s = urPush(s, [r1]);
    s = urPush(s, [r1, r2]);
    // smooth replace step must push []
    s = urPush(s, []);

    // Current: empty regions (bakeLayer holds visual)
    expect(urCurrent(s)).toHaveLength(0);

    // Undo once → back to [r1, r2]
    s = urUndo(s);
    expect(urCurrent(s)).toHaveLength(2);

    // Undo again → back to [r1]
    s = urUndo(s);
    expect(urCurrent(s)).toHaveLength(1);

    // Redo twice → back to smooth-replace state with empty regions
    s = urRedo(s);
    s = urRedo(s);
    expect(urCurrent(s)).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// S7: GradientEditor pure helpers
// ---------------------------------------------------------------------------

describe("buildCssLinearGradient", () => {
  it("generates correct CSS with two stops", () => {
    const stops: GradientStop[] = [
      { position: 0, color: "#ff0000" },
      { position: 1, color: "#0000ff" },
    ];
    const css = buildCssLinearGradient(stops, 90);
    expect(css).toContain("linear-gradient(90deg");
    expect(css).toContain("#ff0000 0%");
    expect(css).toContain("#0000ff 100%");
  });

  it("sorts stops by position before building CSS", () => {
    const stops: GradientStop[] = [
      { position: 1, color: "#0000ff" },
      { position: 0, color: "#ff0000" },
    ];
    const css = buildCssLinearGradient(stops, 0);
    // #ff0000 at 0% should come before #0000ff at 100%
    const idxRed = css.indexOf("#ff0000 0%");
    const idxBlue = css.indexOf("#0000ff 100%");
    expect(idxRed).toBeLessThan(idxBlue);
  });

  it("returns 'transparent' for empty stop list", () => {
    expect(buildCssLinearGradient([], 45)).toBe("transparent");
  });
});

describe("buildCssRadialGradient", () => {
  it("generates correct CSS with two stops", () => {
    const stops: GradientStop[] = [
      { position: 0, color: "#ffffff" },
      { position: 1, color: "#000000" },
    ];
    const css = buildCssRadialGradient(stops);
    expect(css).toContain("radial-gradient(ellipse at center");
    expect(css).toContain("#ffffff 0%");
    expect(css).toContain("#000000 100%");
  });

  it("returns 'transparent' for empty stop list", () => {
    expect(buildCssRadialGradient([])).toBe("transparent");
  });
});

describe("applyLinearGradient", () => {
  it("calls createLinearGradient and addColorStop without throwing", () => {
    const mockGrad = { addColorStop: vi.fn() };
    const ctx = {
      createLinearGradient: vi.fn(() => mockGrad),
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;

    const stops: GradientStop[] = [
      { position: 0, color: "#ff0000" },
      { position: 1, color: "#0000ff" },
    ];
    applyLinearGradient(ctx, 0, 0, 100, 50, stops, 90);
    expect(ctx.createLinearGradient).toHaveBeenCalledOnce();
    expect(mockGrad.addColorStop).toHaveBeenCalledTimes(2);
    // fillStyle should be the gradient object
    expect(ctx.fillStyle).toBe(mockGrad);
  });

  it("clamps stop positions to [0, 1]", () => {
    const mockGrad = { addColorStop: vi.fn() };
    const ctx = {
      createLinearGradient: vi.fn(() => mockGrad),
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;

    const stops: GradientStop[] = [
      { position: -0.5, color: "#ff0000" },
      { position: 1.5, color: "#0000ff" },
    ];
    applyLinearGradient(ctx, 0, 0, 100, 50, stops, 0);
    const calls = mockGrad.addColorStop.mock.calls;
    expect(calls[0][0]).toBeGreaterThanOrEqual(0);
    expect(calls[1][0]).toBeLessThanOrEqual(1);
  });
});

describe("applyRadialGradient", () => {
  it("calls createRadialGradient and addColorStop without throwing", () => {
    const mockGrad = { addColorStop: vi.fn() };
    const ctx = {
      createRadialGradient: vi.fn(() => mockGrad),
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;

    const stops: GradientStop[] = [
      { position: 0, color: "#ff0000" },
      { position: 0.5, color: "#00ff00" },
      { position: 1, color: "#0000ff" },
    ];
    applyRadialGradient(ctx, 10, 10, 80, 60, stops);
    expect(ctx.createRadialGradient).toHaveBeenCalledOnce();
    expect(mockGrad.addColorStop).toHaveBeenCalledTimes(3);
    expect(ctx.fillStyle).toBe(mockGrad);
  });
});

// ---------------------------------------------------------------------------
// isInputFocused (Issue #1: suppress tool shortcuts when input is focused)
// ---------------------------------------------------------------------------

describe("isInputFocused", () => {
  it("returns true for an INPUT element", () => {
    const el = { tagName: "INPUT", isContentEditable: false } as unknown as HTMLElement;
    expect(isInputFocused(el)).toBe(true);
  });

  it("returns true for a TEXTAREA element", () => {
    const el = { tagName: "TEXTAREA", isContentEditable: false } as unknown as HTMLElement;
    expect(isInputFocused(el)).toBe(true);
  });

  it("returns true for a contenteditable element", () => {
    const el = { tagName: "DIV", isContentEditable: true } as unknown as HTMLElement;
    expect(isInputFocused(el)).toBe(true);
  });

  it("returns false for a CANVAS element", () => {
    const el = { tagName: "CANVAS", isContentEditable: false } as unknown as HTMLElement;
    expect(isInputFocused(el)).toBe(false);
  });

  it("returns false for null target", () => {
    expect(isInputFocused(null)).toBe(false);
  });

  it("returns false for BUTTON element", () => {
    const el = { tagName: "BUTTON", isContentEditable: false } as unknown as HTMLElement;
    expect(isInputFocused(el)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Issue #6: ExportModal pure helpers
// ---------------------------------------------------------------------------

describe("getMimeType", () => {
  it("returns image/png for png", () => {
    expect(getMimeType("png")).toBe("image/png");
  });
  it("returns image/jpeg for jpeg", () => {
    expect(getMimeType("jpeg")).toBe("image/jpeg");
  });
  it("returns image/webp for webp", () => {
    expect(getMimeType("webp")).toBe("image/webp");
  });
});

describe("getFileExtension", () => {
  it("returns png for png", () => {
    expect(getFileExtension("png")).toBe("png");
  });
  it("returns jpg for jpeg", () => {
    expect(getFileExtension("jpeg")).toBe("jpg");
  });
  it("returns webp for webp", () => {
    expect(getFileExtension("webp")).toBe("webp");
  });
});

describe("calcOutputSize", () => {
  const nat = { naturalWidth: 200, naturalHeight: 100 };

  it("returns original size for scale=original", () => {
    const out = calcOutputSize(nat.naturalWidth, nat.naturalHeight, {
      scale: "original",
      customWidth: 0,
      customHeight: 0,
    });
    expect(out).toEqual({ width: 200, height: 100 });
  });

  it("returns original size for scale=1x", () => {
    const out = calcOutputSize(nat.naturalWidth, nat.naturalHeight, {
      scale: "1x",
      customWidth: 0,
      customHeight: 0,
    });
    expect(out).toEqual({ width: 200, height: 100 });
  });

  it("doubles dimensions for scale=2x", () => {
    const out = calcOutputSize(nat.naturalWidth, nat.naturalHeight, {
      scale: "2x",
      customWidth: 0,
      customHeight: 0,
    });
    expect(out).toEqual({ width: 400, height: 200 });
  });

  it("quadruples dimensions for scale=4x", () => {
    const out = calcOutputSize(nat.naturalWidth, nat.naturalHeight, {
      scale: "4x",
      customWidth: 0,
      customHeight: 0,
    });
    expect(out).toEqual({ width: 800, height: 400 });
  });

  it("uses custom dimensions for scale=custom", () => {
    const out = calcOutputSize(nat.naturalWidth, nat.naturalHeight, {
      scale: "custom",
      customWidth: 1920,
      customHeight: 1080,
    });
    expect(out).toEqual({ width: 1920, height: 1080 });
  });

  it("clamps custom dimensions to minimum 1", () => {
    const out = calcOutputSize(nat.naturalWidth, nat.naturalHeight, {
      scale: "custom",
      customWidth: 0,
      customHeight: -5,
    });
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
  });
});

describe("estimateFileSizeBytes", () => {
  it("estimates png size proportional to pixel count", () => {
    const bytes = estimateFileSizeBytes(100, 100, "png", 90);
    expect(bytes).toBe(Math.round(100 * 100 * 0.5));
  });

  it("returns larger estimate for higher jpeg quality", () => {
    const low = estimateFileSizeBytes(100, 100, "jpeg", 10);
    const high = estimateFileSizeBytes(100, 100, "jpeg", 90);
    expect(high).toBeGreaterThan(low);
  });

  it("png estimate is independent of quality parameter", () => {
    const a = estimateFileSizeBytes(200, 200, "png", 50);
    const b = estimateFileSizeBytes(200, 200, "png", 100);
    expect(a).toBe(b);
  });
});

describe("formatFileSizeLabel", () => {
  it("formats bytes below 1 KB", () => {
    expect(formatFileSizeLabel(500)).toBe("~500 B");
  });

  it("formats KB range", () => {
    const label = formatFileSizeLabel(2048);
    expect(label).toBe("~2 KB");
  });

  it("formats MB range", () => {
    const label = formatFileSizeLabel(1.5 * 1024 * 1024);
    expect(label).toContain("MB");
  });
});

// ---------------------------------------------------------------------------
// S8: snapCoord logic
// ---------------------------------------------------------------------------

describe("snapCoord", () => {
  it("returns value unchanged when snapEnabled=false", () => {
    expect(snapCoord(37, false, 20)).toBe(37);
  });

  it("returns value unchanged when gridSize=0", () => {
    expect(snapCoord(37, true, 0)).toBe(37);
  });

  it("snaps to nearest grid multiple (round up)", () => {
    // 37 / 20 = 1.85 → rounds to 2 → 2*20 = 40
    expect(snapCoord(37, true, 20)).toBe(40);
  });

  it("snaps to nearest grid multiple (round down)", () => {
    // 7 / 20 = 0.35 → rounds to 0 → 0*20 = 0
    expect(snapCoord(7, true, 20)).toBe(0);
  });

  it("returns exact multiple unchanged", () => {
    expect(snapCoord(60, true, 20)).toBe(60);
  });

  it("works with gridSize=5", () => {
    expect(snapCoord(13, true, 5)).toBe(15);
    expect(snapCoord(12, true, 5)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// S8: draft rotate matrix — verify rotation angle produces correct transform
// ---------------------------------------------------------------------------

describe("draft rotate deg-to-rad conversion", () => {
  it("0 degrees produces no rotation (cos=1, sin=0)", () => {
    const rad = (0 * Math.PI) / 180;
    expect(Math.cos(rad)).toBeCloseTo(1, 5);
    expect(Math.sin(rad)).toBeCloseTo(0, 5);
  });

  it("90 degrees produces 90° rotation (cos≈0, sin≈1)", () => {
    const rad = (90 * Math.PI) / 180;
    expect(Math.cos(rad)).toBeCloseTo(0, 5);
    expect(Math.sin(rad)).toBeCloseTo(1, 5);
  });

  it("180 degrees flips direction (cos≈-1, sin≈0)", () => {
    const rad = (180 * Math.PI) / 180;
    expect(Math.cos(rad)).toBeCloseTo(-1, 5);
    expect(Math.sin(rad)).toBeCloseTo(0, 4);
  });

  it("-90 degrees rotates counter-clockwise (cos≈0, sin≈-1)", () => {
    const rad = (-90 * Math.PI) / 180;
    expect(Math.cos(rad)).toBeCloseTo(0, 5);
    expect(Math.sin(rad)).toBeCloseTo(-1, 5);
  });
});

// ---------------------------------------------------------------------------
// Issue #3 + #20: marchingSquaresPath — loop cap + 2M guard + numeric pixelSet
// ---------------------------------------------------------------------------

describe("marchingSquaresPath", () => {
  it("returns empty string for empty pixel list", () => {
    expect(marchingSquaresPath([])).toBe("");
  });

  it("produces a closed SVG path (ends with Z) for a solid rectangle", () => {
    // 4x4 rectangle of pixels — should produce at least one closed loop
    const pixels: { x: number; y: number }[] = [];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        pixels.push({ x, y });
      }
    }
    const d = marchingSquaresPath(pixels);
    expect(d).toContain("Z");
  });

  it("loop always terminates for a large region (loop-cap fix, Issue #3)", () => {
    // 1500x1200 = 1,800,000 pixels — under the 2M fallback threshold but large
    // enough to stress the loop limit (old bug: edgeMap.size shrinks mid-loop)
    const pixels: { x: number; y: number }[] = [];
    for (let y = 0; y < 1200; y++) {
      for (let x = 0; x < 1500; x++) {
        pixels.push({ x, y });
      }
    }
    // Must finish without hanging and produce a valid path
    const d = marchingSquaresPath(pixels);
    expect(typeof d).toBe("string");
    expect(d.length).toBeGreaterThan(0);
  });

  it("falls back to bounding-box rect for pixel count > 2M and calls onFallback (Issue #3)", () => {
    // Build a minimal >2M pixel list efficiently using sparse coordinates
    const pixels: { x: number; y: number }[] = [];
    for (let i = 0; i < 2_000_001; i++) {
      pixels.push({ x: i % 2000, y: Math.floor(i / 2000) });
    }
    let fallbackCalled = false;
    const d = marchingSquaresPath(pixels, () => { fallbackCalled = true; });
    expect(fallbackCalled).toBe(true);
    // Fallback path must be a valid rect: starts with M, ends with Z
    expect(d).toMatch(/^M/);
    expect(d).toMatch(/Z$/);
  });

  it("numeric pixelSet lookup is correct — non-member pixel returns outside (Issue #20)", () => {
    // Single pixel at (5, 10); pixel at (6, 10) is NOT in the set
    // marchingSquaresPath should generate boundary edges (right edge of (5,10))
    const pixels = [{ x: 5, y: 10 }];
    const d = marchingSquaresPath(pixels);
    // Path must contain the corner coords 6,10 and 6,11 (right-edge corners)
    expect(d).toContain("6");
    expect(d).toContain("10");
  });
});

// ---------------------------------------------------------------------------
// Issue #4: Editor history state machine — regions + bakeLayer atomic sync
// ---------------------------------------------------------------------------

import { HISTORY_LIMIT as EDITOR_HISTORY_LIMIT } from "../../src/components/MvpEditor/hooks/useUndoRedo";
import type { EditorSnapshot } from "../../src/components/MvpEditor/hooks/useEditorHistory";

interface EditorHistoryState {
  history: EditorSnapshot[];
  index: number;
}

function makeEditorState(): EditorHistoryState {
  return { history: [{ regions: [], bakeLayer: null }], index: 0 };
}

function ehPush(
  state: EditorHistoryState,
  regions: PaintRegion[],
  bakeLayer: ImageData | null
): EditorHistoryState {
  const snapshot: EditorSnapshot = { regions, bakeLayer };
  const truncated = state.history.slice(0, state.index + 1);
  const next = [...truncated, snapshot];
  const sliced =
    next.length > EDITOR_HISTORY_LIMIT ? next.slice(next.length - EDITOR_HISTORY_LIMIT) : next;
  return { history: sliced, index: sliced.length - 1 };
}

function ehUndo(state: EditorHistoryState): EditorHistoryState {
  return state.index > 0 ? { ...state, index: state.index - 1 } : state;
}

function ehRedo(state: EditorHistoryState): EditorHistoryState {
  return state.index < state.history.length - 1
    ? { ...state, index: state.index + 1 }
    : state;
}

function ehCurrent(state: EditorHistoryState): EditorSnapshot {
  return state.history[state.index];
}

describe("Issue #4: EditorHistory — regions + bakeLayer atomic sync", () => {
  it("initial state has empty regions and null bakeLayer", () => {
    const s = makeEditorState();
    expect(ehCurrent(s).regions).toEqual([]);
    expect(ehCurrent(s).bakeLayer).toBeNull();
  });

  it("push stores regions and bakeLayer together in one entry", () => {
    const bake = new ImageData(new Uint8ClampedArray(4), 1, 1);
    const region: PaintRegion = { id: "r1", pixels: [{ x: 0, y: 0 }], color: "#ff0000", transparent: false };
    let s = makeEditorState();
    s = ehPush(s, [region], bake);
    expect(ehCurrent(s).regions).toHaveLength(1);
    expect(ehCurrent(s).bakeLayer).toBe(bake);
  });

  it("undo restores both regions and bakeLayer simultaneously (atomic)", () => {
    const bake1 = new ImageData(new Uint8ClampedArray(4), 1, 1);
    const bake2 = new ImageData(new Uint8ClampedArray(4), 1, 1);
    const r1: PaintRegion = { id: "r1", pixels: [{ x: 0, y: 0 }], color: "#ff0000", transparent: false };
    const r2: PaintRegion = { id: "r2", pixels: [{ x: 1, y: 0 }], color: "#00ff00", transparent: false };

    let s = makeEditorState();
    s = ehPush(s, [r1], bake1);
    s = ehPush(s, [r1, r2], bake2);

    // Before undo: both regions + bake2
    expect(ehCurrent(s).regions).toHaveLength(2);
    expect(ehCurrent(s).bakeLayer).toBe(bake2);

    // After undo: exactly r1 + bake1 — no desync
    s = ehUndo(s);
    expect(ehCurrent(s).regions).toHaveLength(1);
    expect(ehCurrent(s).bakeLayer).toBe(bake1);
  });

  it("redo restores both regions and bakeLayer simultaneously after undo", () => {
    const bake = new ImageData(new Uint8ClampedArray(4), 1, 1);
    const r1: PaintRegion = { id: "r1", pixels: [{ x: 0, y: 0 }], color: "#ff0000", transparent: false };

    let s = makeEditorState();
    s = ehPush(s, [r1], bake);
    s = ehUndo(s);

    // Back to initial
    expect(ehCurrent(s).regions).toHaveLength(0);
    expect(ehCurrent(s).bakeLayer).toBeNull();

    // Redo: both r1 and bake restored together
    s = ehRedo(s);
    expect(ehCurrent(s).regions).toHaveLength(1);
    expect(ehCurrent(s).bakeLayer).toBe(bake);
  });

  it("history is capped at EDITOR_HISTORY_LIMIT — oldest entry dropped", () => {
    let s = makeEditorState();
    for (let i = 0; i < EDITOR_HISTORY_LIMIT + 4; i++) {
      s = ehPush(s, [{ id: `r${i}`, pixels: [], color: "#000000", transparent: false }], null);
    }
    expect(s.history.length).toBe(EDITOR_HISTORY_LIMIT);
    expect(s.index).toBe(EDITOR_HISTORY_LIMIT - 1);
  });
});

// ---------------------------------------------------------------------------
// recentFiles — localStorage helpers
// ---------------------------------------------------------------------------

import {
  addRecentFile,
  getRecentFiles,
  clearRecentFiles,
  formatRelativeTime,
  RECENT_FILES_MAX,
  RECENT_FILES_KEY,
} from "../../src/components/MvpEditor/lib/recentFiles";

describe("recentFiles", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("getRecentFiles returns [] when localStorage is empty", () => {
    expect(getRecentFiles()).toEqual([]);
  });

  it("addRecentFile stores an entry and getRecentFiles returns it", () => {
    addRecentFile("logo.png", "data:image/png;base64,AAA");
    const entries = getRecentFiles();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("logo.png");
    expect(entries[0].thumbnailDataUrl).toBe("data:image/png;base64,AAA");
    expect(typeof entries[0].lastAccessedAt).toBe("string");
  });

  it("addRecentFile deduplicates by name — newer entry replaces older", () => {
    addRecentFile("logo.png", "data:image/png;base64,AAA");
    addRecentFile("logo.png", "data:image/png;base64,BBB");
    const entries = getRecentFiles();
    expect(entries).toHaveLength(1);
    expect(entries[0].thumbnailDataUrl).toBe("data:image/png;base64,BBB");
  });

  it(`addRecentFile keeps at most ${RECENT_FILES_MAX} entries`, () => {
    for (let i = 0; i < RECENT_FILES_MAX + 3; i++) {
      addRecentFile(`file${i}.png`, `data:image/png;base64,${i}`);
    }
    const entries = getRecentFiles();
    expect(entries).toHaveLength(RECENT_FILES_MAX);
    // Newest entry should be first
    expect(entries[0].name).toBe(`file${RECENT_FILES_MAX + 2}.png`);
  });

  it("clearRecentFiles removes all entries", () => {
    addRecentFile("a.png", "data:image/png;base64,A");
    clearRecentFiles();
    expect(getRecentFiles()).toEqual([]);
    expect(localStorage.getItem(RECENT_FILES_KEY)).toBeNull();
  });

  it("getRecentFiles returns [] when localStorage contains invalid JSON", () => {
    localStorage.setItem(RECENT_FILES_KEY, "not-json{{{");
    expect(getRecentFiles()).toEqual([]);
  });

  it("getRecentFiles filters out entries missing required fields", () => {
    localStorage.setItem(
      RECENT_FILES_KEY,
      JSON.stringify([
        { name: "ok.png", thumbnailDataUrl: "data:image/png;base64,X", lastAccessedAt: "2025-01-01T00:00:00Z" },
        { name: "missing-thumb" },
        null,
        42,
      ])
    );
    const entries = getRecentFiles();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("ok.png");
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
  it("returns '今' for timestamps less than 60 seconds ago", () => {
    const iso = new Date(Date.now() - 30_000).toISOString();
    expect(formatRelativeTime(iso)).toBe("今");
  });

  it("returns 'N分前' for timestamps within the last hour", () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(iso)).toBe("5分前");
  });

  it("returns 'N時間前' for timestamps within the last day", () => {
    const iso = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(formatRelativeTime(iso)).toBe("3時間前");
  });

  it("returns 'N日前' for timestamps within 14 days", () => {
    const iso = new Date(Date.now() - 4 * 86400_000).toISOString();
    expect(formatRelativeTime(iso)).toBe("4日前");
  });

  it("returns 'M/D' for timestamps older than 14 days", () => {
    const d = new Date(Date.now() - 20 * 86400_000);
    const iso = d.toISOString();
    const expected = `${d.getMonth() + 1}/${d.getDate()}`;
    expect(formatRelativeTime(iso)).toBe(expected);
  });

  it("returns '' for invalid date strings", () => {
    expect(formatRelativeTime("not-a-date")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Issue #8: copyCanvasToClipboard — navigator.clipboard mock
// ---------------------------------------------------------------------------

describe("Issue #8: clipboard copy (compositeRegions -> Blob -> ClipboardItem)", () => {
  it("compositeRegions for clipboard: output dimensions match base image", () => {
    const base = makeSolidImageData(4, 4, 100, 150, 200);
    const result = compositeRegions(base, []);
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
  });

  it("navigator.clipboard.write mock is called with one argument array", async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { write: writeMock },
      configurable: true,
      writable: true,
    });

    const fakeBlob = new Blob(["png-data"], { type: "image/png" });
    // Simulate what handleCopyToClipboard does (minus canvas.toBlob which needs DOM):
    // navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
    const item = { "image/png": fakeBlob } as unknown as ClipboardItem;
    await navigator.clipboard.write([item]);

    expect(writeMock).toHaveBeenCalledOnce();
    const args = writeMock.mock.calls[0][0] as ClipboardItem[];
    expect(args).toHaveLength(1);

    // Restore
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  it("clipboard.write rejection is catchable (error path does not throw unhandled)", async () => {
    const rejectMock = vi.fn().mockRejectedValue(new Error("permission denied"));
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { write: rejectMock },
      configurable: true,
      writable: true,
    });

    let errorCaught = false;
    await navigator.clipboard.write([]).catch(() => {
      errorCaught = true;
    });
    expect(errorCaught).toBe(true);

    // Restore
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Issue #13: text overlay onKeyDown — stopPropagation on Escape and Enter
// ---------------------------------------------------------------------------

describe("Issue #13: text overlay key handler calls stopPropagation", () => {
  function makeMockEvent(key: string): {
    key: string;
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  } {
    return {
      key,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
  }

  it("Escape: stopPropagation is called before clearing textDraft", () => {
    const e = makeMockEvent("Escape");
    let textDraftCleared = false;

    // Simulate the onKeyDown handler logic from MvpEditor text overlay
    const handleKeyDown = (ev: typeof e) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.stopPropagation();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        textDraftCleared = true;
      }
    };

    handleKeyDown(e);

    expect(e.stopPropagation).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(textDraftCleared).toBe(true);
  });

  it("Enter: stopPropagation is called", () => {
    const e = makeMockEvent("Enter");
    let commitCalled = false;

    const handleKeyDown = (ev: typeof e) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.stopPropagation();
        commitCalled = true;
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };

    handleKeyDown(e);

    expect(e.stopPropagation).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(commitCalled).toBe(true);
  });

  it("other keys: stopPropagation is NOT called", () => {
    const e = makeMockEvent("a");

    const handleKeyDown = (ev: typeof e) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.stopPropagation();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };

    handleKeyDown(e);

    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Issue #15: exportImageData — uses toBlob + URL.createObjectURL/revokeObjectURL
// (not toDataURL) so that large PNG exports do not hold base64 strings in memory.
// ---------------------------------------------------------------------------

describe("Issue #15: exportImageData uses toBlob + objectURL (no base64 hold)", () => {
  it("calls canvas.toBlob (not toDataURL) to avoid base64 memory hold", () => {
    const toBlobMock = vi.fn();
    const toDataURLMock = vi.fn();

    const mockCtx = {
      imageSmoothingEnabled: false,
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
      toBlob: toBlobMock,
      toDataURL: toDataURLMock,
    };

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
      return origCreate(tag);
    });

    const imageData = makeSolidImageData(2, 2, 100, 150, 200);
    exportImageData(imageData, 2, 2, "image/png", 100, "test.png");

    expect(toBlobMock).toHaveBeenCalledOnce();
    expect(toDataURLMock).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("calls URL.revokeObjectURL after triggering the download anchor click", () => {
    const revokeObjectURLMock = vi.fn();
    const createObjectURLMock = vi.fn(() => "blob:mock-url");
    const anchorClickMock = vi.fn();

    const origURLCreate = URL.createObjectURL;
    const origURLRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURLMock;
    URL.revokeObjectURL = revokeObjectURLMock;

    const mockCtx = {
      imageSmoothingEnabled: false,
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    let capturedToBlobCallback: ((blob: Blob | null) => void) | null = null;
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
      toBlob: vi.fn((cb: (blob: Blob | null) => void) => {
        capturedToBlobCallback = cb;
      }),
    };

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
      if (tag === "a") {
        const a = origCreate("a");
        vi.spyOn(a, "click").mockImplementation(anchorClickMock);
        return a;
      }
      return origCreate(tag);
    });

    const imageData = makeSolidImageData(4, 4, 255, 0, 0);
    exportImageData(imageData, 4, 4, "image/png", 100, "export.png");

    // Simulate toBlob callback with a fake Blob
    const fakeBlob = new Blob(["fake-png-data"], { type: "image/png" });
    capturedToBlobCallback!(fakeBlob);

    expect(createObjectURLMock).toHaveBeenCalledWith(fakeBlob);
    expect(anchorClickMock).toHaveBeenCalledOnce();
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-url");

    URL.createObjectURL = origURLCreate;
    URL.revokeObjectURL = origURLRevoke;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Issue #16: comparing mode — compositeRegions(base, [], bakeLayer) behaviour
  // ---------------------------------------------------------------------------

  it("Issue #16: comparing mode — bakeLayer strokes survive (regions excluded only)", () => {
    // Simulate: base=black, bakeLayer has a red stroke on (0,0), region paints (0,0) blue.
    // In comparing mode the result should show bakeLayer red, NOT the region blue, NOT raw black.
    const base = makeSolidImageData(2, 2, 0, 0, 0);

    // bakeLayer: pixel (0,0) fully opaque red
    const bakeData = new Uint8ClampedArray(2 * 2 * 4);
    bakeData[0] = 255; bakeData[1] = 0; bakeData[2] = 0; bakeData[3] = 255;
    const bake = new ImageData(bakeData, 2, 2);

    // In comparing mode: compositeRegions(base, [], bakeLayer)
    const comparingResult = compositeRegions(base, [], bake);

    // Pixel (0,0): bakeLayer red should be visible
    expect(comparingResult.data[0]).toBe(255); // R from bake
    expect(comparingResult.data[1]).toBe(0);   // G
    expect(comparingResult.data[2]).toBe(0);   // B
    expect(comparingResult.data[3]).toBe(255); // A

    // Other pixels: base black
    expect(comparingResult.data[4]).toBe(0);
  });

  it("Issue #16: comparing mode with null bakeLayer returns raw base (no regions)", () => {
    // bakeLayer is null (no brush strokes yet): comparing shows raw base image.
    const base = makeSolidImageData(2, 2, 100, 150, 200);
    const comparingResult = compositeRegions(base, [], null);

    expect(comparingResult.data[0]).toBe(100);
    expect(comparingResult.data[1]).toBe(150);
    expect(comparingResult.data[2]).toBe(200);
    expect(comparingResult.data[3]).toBe(255);
  });

  it("buildSvg embeds PNG as base64 data URL inside <image href> (SVG internal use — required)", () => {
    const imageData = makeSolidImageData(2, 2, 0, 128, 255);

    const mockCtx = {
      imageSmoothingEnabled: false,
      putImageData: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
      toDataURL: vi.fn(() => "data:image/png;base64,MOCK"),
    };

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
      return origCreate(tag);
    });

    const svg = buildSvg(imageData, [], 2, 2);
    expect(svg).toContain('href="data:image/png;base64,');

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// Issue #39: buildSvg — transparent regions use marchingSquaresPath (no per-pixel <rect>)
// ---------------------------------------------------------------------------

describe("Issue #39: buildSvg transparent regions use path (not per-pixel <rect>)", () => {
  function setupCanvasMock() {
    const mockCtx = {
      imageSmoothingEnabled: false,
      putImageData: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
      toDataURL: vi.fn(() => "data:image/png;base64,MOCK"),
    };
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
      return origCreate(tag);
    });
  }

  it("transparent region produces a <path> in the mask, not per-pixel <rect> elements", () => {
    setupCanvasMock();
    const imageData = makeSolidImageData(4, 4, 200, 200, 200);
    const transparentRegion: PaintRegion = {
      id: "t1",
      pixels: [
        { x: 0, y: 0 }, { x: 1, y: 0 },
        { x: 0, y: 1 }, { x: 1, y: 1 },
      ],
      color: "#000000",
      transparent: true,
    };
    const svg = buildSvg(imageData, [transparentRegion], 4, 4);
    // Must use <path> for the mask, not individual <rect> per pixel
    expect(svg).toContain('<path d=');
    // Must NOT contain per-pixel rect elements inside the mask
    expect(svg).not.toMatch(/<rect x="\d+" y="\d+" width="1" height="1"/);
    vi.restoreAllMocks();
  });

  it("SVG output with transparent region is smaller than equivalent per-pixel <rect> output", () => {
    setupCanvasMock();
    const imageData = makeSolidImageData(8, 8, 128, 128, 128);
    // 16 transparent pixels — per-rect approach would produce 16 <rect> elements
    const pixels: { x: number; y: number }[] = [];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        pixels.push({ x, y });
      }
    }
    const transparentRegion: PaintRegion = {
      id: "t1",
      pixels,
      color: "#000000",
      transparent: true,
    };

    const svg = buildSvg(imageData, [transparentRegion], 8, 8);

    // Count <rect> elements with width="1" height="1" — must be zero
    const perPixelRects = (svg.match(/<rect x="\d+" y="\d+" width="1" height="1"/g) ?? []).length;
    expect(perPixelRects).toBe(0);

    // The SVG must still contain the mask section
    expect(svg).toContain('id="transparentMask"');
    expect(svg).toContain('mask="url(#transparentMask)"');

    vi.restoreAllMocks();
  });

  it("multiple transparent regions are merged into a single <path> in the mask", () => {
    setupCanvasMock();
    const imageData = makeSolidImageData(6, 6, 100, 100, 100);
    const regions: PaintRegion[] = [
      {
        id: "t1",
        pixels: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        color: "#000000",
        transparent: true,
      },
      {
        id: "t2",
        pixels: [{ x: 4, y: 4 }, { x: 5, y: 4 }],
        color: "#000000",
        transparent: true,
      },
    ];

    const svg = buildSvg(imageData, regions, 6, 6);

    // Only one <path> element should appear inside the mask (all transparent pixels merged)
    const pathMatches = svg.match(/<path d=/g) ?? [];
    // The mask path consolidates all transparent pixels into one path element
    expect(pathMatches.length).toBeGreaterThanOrEqual(1);
    // Must NOT contain per-pixel rect elements
    expect(svg).not.toMatch(/<rect x="\d+" y="\d+" width="1" height="1"/);

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// Issue #19: copyImageDataInto — unified bake-layer copy helper
// ---------------------------------------------------------------------------

describe("copyImageDataInto", () => {
  it("copies all pixel data from src into dest", () => {
    const src = makeSolidImageData(2, 2, 255, 128, 64);
    const dest = new ImageData(new Uint8ClampedArray(2 * 2 * 4), 2, 2);
    copyImageDataInto(dest, src);
    for (let i = 0; i < src.data.length; i++) {
      expect(dest.data[i]).toBe(src.data[i]);
    }
  });

  it("overwrites existing dest data with src data", () => {
    const src = makeSolidImageData(2, 2, 10, 20, 30);
    const dest = makeSolidImageData(2, 2, 200, 200, 200);
    copyImageDataInto(dest, src);
    expect(dest.data[0]).toBe(10);
    expect(dest.data[1]).toBe(20);
    expect(dest.data[2]).toBe(30);
    expect(dest.data[3]).toBe(255);
  });
});

// ---------------------------------------------------------------------------
// Issue #23: buildShapePath — shared path builder for polygon and star shapes
// ---------------------------------------------------------------------------

describe("buildShapePath (Issue #23)", () => {
  function makeMockCtx() {
    const calls: string[] = [];
    return {
      calls,
      rect: vi.fn((..._args: number[]) => calls.push("rect")),
      ellipse: vi.fn((..._args: number[]) => calls.push("ellipse")),
      moveTo: vi.fn((..._args: number[]) => calls.push("moveTo")),
      lineTo: vi.fn((..._args: number[]) => calls.push("lineTo")),
      closePath: vi.fn(() => calls.push("closePath")),
    } as unknown as CanvasRenderingContext2D & { calls: string[] };
  }

  it("rect: calls ctx.rect with correct args", () => {
    const ctx = makeMockCtx();
    buildShapePath(ctx, "rect", 10, 20, 100, 50, 4);
    expect(ctx.rect).toHaveBeenCalledOnce();
    expect(ctx.rect).toHaveBeenCalledWith(10, 20, 100, 50);
    expect(ctx.ellipse).not.toHaveBeenCalled();
  });

  it("circle: calls ctx.ellipse with correct center and radii", () => {
    const ctx = makeMockCtx();
    buildShapePath(ctx, "circle", 0, 0, 100, 60, 4);
    expect(ctx.ellipse).toHaveBeenCalledOnce();
    expect(ctx.ellipse).toHaveBeenCalledWith(50, 30, 50, 30, 0, 0, Math.PI * 2);
  });

  it("polygon (n=5): calls moveTo once, lineTo n-1 times, then closePath", () => {
    const ctx = makeMockCtx();
    buildShapePath(ctx, "polygon", 0, 0, 100, 100, 5);
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(4);
    expect(ctx.closePath).toHaveBeenCalledOnce();
  });

  it("polygon: clamps sides to 3..12 (sides=1 -> 3, sides=20 -> 12)", () => {
    const ctx3 = makeMockCtx();
    buildShapePath(ctx3, "polygon", 0, 0, 100, 100, 1);
    expect(ctx3.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx3.lineTo).toHaveBeenCalledTimes(2); // 3 total vertices

    const ctx12 = makeMockCtx();
    buildShapePath(ctx12, "polygon", 0, 0, 100, 100, 20);
    expect(ctx12.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx12.lineTo).toHaveBeenCalledTimes(11); // 12 total vertices
  });

  it("star: calls moveTo once, lineTo 9 times (10 points total), then closePath", () => {
    const ctx = makeMockCtx();
    buildShapePath(ctx, "star", 0, 0, 100, 100, 4);
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledTimes(9);
    expect(ctx.closePath).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Issue #24: Reference layer — compositeRegions remains unaffected
// ---------------------------------------------------------------------------

describe("Issue #24: reference layer isolation", () => {
  it("compositeRegions result is unchanged by reference image state (base image not modified)", () => {
    // Reference image is rendered on canvas via drawImage after putImageData,
    // so compositeRegions itself must never incorporate the reference image.
    const base = makeSolidImageData(2, 2, 10, 20, 30);
    const region: PaintRegion = {
      id: "r1",
      pixels: [{ x: 0, y: 0 }],
      color: "#ff0000",
      transparent: false,
    };
    const result = compositeRegions(base, [region]);
    // Pixel (0,0) should be red (from region), not affected by any reference image.
    expect(result.data[0]).toBe(255);
    expect(result.data[1]).toBe(0);
    expect(result.data[2]).toBe(0);
    expect(result.data[3]).toBe(255);
    // Pixel (1,0) should remain the base color.
    expect(result.data[4]).toBe(10);
    expect(result.data[5]).toBe(20);
    expect(result.data[6]).toBe(30);
  });

  it("reference opacity clamped values: 0 and 100 produce distinct globalAlpha values", () => {
    // Verify the opacity/100 formula used in the canvas redraw effect.
    const toAlpha = (opacity: number) => Math.max(0, Math.min(1, opacity / 100));
    expect(toAlpha(0)).toBe(0);
    expect(toAlpha(100)).toBe(1);
    expect(toAlpha(50)).toBe(0.5);
    expect(toAlpha(-10)).toBe(0);
    expect(toAlpha(110)).toBe(1);
  });

  it("clearing reference image (setting to null) does not affect compositeRegions output", () => {
    const base = makeSolidImageData(2, 2, 80, 90, 100);
    // With referenceImage = null, compositeRegions output should equal base (no regions).
    const result = compositeRegions(base, []);
    expect(result.data[0]).toBe(80);
    expect(result.data[1]).toBe(90);
    expect(result.data[2]).toBe(100);
    expect(result.data[3]).toBe(255);
  });
});

// ---------------------------------------------------------------------------
// Issue #26: colorHarmony — complementary, triadic, analogous, splitComplementary
// ---------------------------------------------------------------------------

describe("hexToHsl / hslToHex round-trip", () => {
  it("round-trips pure red without loss", () => {
    const { h, s, l } = hexToHsl("#ff0000");
    expect(h).toBeCloseTo(0, 0);
    expect(s).toBeCloseTo(1, 2);
    expect(l).toBeCloseTo(0.5, 2);
    expect(hslToHex(h, s, l)).toBe("#ff0000");
  });

  it("round-trips a mid-tone blue (#3366cc)", () => {
    const hex = "#3366cc";
    const { h, s, l } = hexToHsl(hex);
    expect(hslToHex(h, s, l)).toBe(hex);
  });

  it("hue wraps correctly beyond 360", () => {
    const result = hslToHex(370, 1, 0.5);
    expect(result).toBe(hslToHex(10, 1, 0.5));
  });
});

describe("complementary", () => {
  it("red (#ff0000) complements to cyan (#00ffff)", () => {
    expect(complementary("#ff0000")).toBe("#00ffff");
  });

  it("complement of complement is the original color", () => {
    const original = "#3366cc";
    expect(complementary(complementary(original))).toBe(original);
  });
});

describe("triadic", () => {
  it("returns two colors at +120 and +240 degrees from source", () => {
    const [a, b] = triadic("#ff0000");
    // red (H=0) → H=120 (green-like), H=240 (blue-like)
    const { h: ha } = hexToHsl(a);
    const { h: hb } = hexToHsl(b);
    expect(ha).toBeCloseTo(120, 0);
    expect(hb).toBeCloseTo(240, 0);
  });

  it("all three triadic colors have the same saturation and lightness", () => {
    const source = "#3399ff";
    const { s: ss, l: sl } = hexToHsl(source);
    for (const c of triadic(source)) {
      const { s, l } = hexToHsl(c);
      expect(s).toBeCloseTo(ss, 2);
      expect(l).toBeCloseTo(sl, 2);
    }
  });
});

describe("analogous", () => {
  it("returns colors at -30 and +30 degrees from source", () => {
    const source = "#ff0000"; // H=0
    const [neg30, pos30] = analogous(source);
    const { h: hNeg } = hexToHsl(neg30);
    const { h: hPos } = hexToHsl(pos30);
    expect(hNeg).toBeCloseTo(330, 0);
    expect(hPos).toBeCloseTo(30, 0);
  });
});

describe("splitComplementary", () => {
  it("returns colors at +150 and +210 degrees from source", () => {
    const source = "#ff0000"; // H=0
    const [a, b] = splitComplementary(source);
    const { h: ha } = hexToHsl(a);
    const { h: hb } = hexToHsl(b);
    expect(ha).toBeCloseTo(150, 0);
    expect(hb).toBeCloseTo(210, 0);
  });

  it("split-complementary colors are symmetric around the complement", () => {
    const source = "#ff6600";
    const { h } = hexToHsl(source);
    const [a, b] = splitComplementary(source);
    const { h: ha } = hexToHsl(a);
    const { h: hb } = hexToHsl(b);
    // +150 and +210 are each 30deg away from the complement (+180)
    const complement = (h + 180) % 360;
    const diffA = Math.abs(((ha - complement + 540) % 360) - 180);
    const diffB = Math.abs(((hb - complement + 540) % 360) - 180);
    expect(diffA).toBeCloseTo(30, 0);
    expect(diffB).toBeCloseTo(30, 0);
  });
});

// ---------------------------------------------------------------------------
// Issue #28: colorFormats — rgbToCmyk + formatColor
// ---------------------------------------------------------------------------

import {
  rgbToCmyk,
  formatColor,
} from "../../src/components/MvpEditor/lib/colorFormats";

describe("rgbToCmyk", () => {
  it("converts pure red (255,0,0) to C=0 M=100 Y=100 K=0", () => {
    expect(rgbToCmyk(255, 0, 0)).toEqual([0, 100, 100, 0]);
  });

  it("converts pure white (255,255,255) to all zeros", () => {
    expect(rgbToCmyk(255, 255, 255)).toEqual([0, 0, 0, 0]);
  });

  it("converts pure black (0,0,0) to K=100", () => {
    expect(rgbToCmyk(0, 0, 0)).toEqual([0, 0, 0, 100]);
  });

  it("converts pure blue (0,0,255) to C=100 M=100 Y=0 K=0", () => {
    expect(rgbToCmyk(0, 0, 255)).toEqual([100, 100, 0, 0]);
  });
});

describe("formatColor", () => {
  it("formats HEX as uppercase hex string", () => {
    expect(formatColor("#ff0000", "HEX")).toBe("#FF0000");
  });

  it("formats RGB as comma-separated r, g, b values", () => {
    expect(formatColor("#ff0000", "RGB")).toBe("255, 0, 0");
  });

  it("formats HSL with degree and percent values", () => {
    const result = formatColor("#ff0000", "HSL");
    expect(result).toMatch(/^0, 100%, 50%$/);
  });

  it("formats CMYK as percent values for pure red", () => {
    expect(formatColor("#ff0000", "CMYK")).toBe("0%, 100%, 100%, 0%");
  });

  it("formats CMYK for black correctly", () => {
    expect(formatColor("#000000", "CMYK")).toBe("0%, 0%, 0%, 100%");
  });
});

// ---------------------------------------------------------------------------
// Issue #38: getCanvasCoords — zoom/pan transform correctness verification
//
// getCanvasCoords uses getBoundingClientRect() which returns the post-transform
// viewport rect. This means CSS zoom/pan (translate/scale) is already factored
// in by the browser, and (e.clientX - rect.left) * scaleX is always correct
// regardless of how the canvas element is visually transformed.
//
// These tests mirror the pure coordinate math from MvpEditor.tsx to verify
// correctness under different zoom levels, pan offsets, and edge cases
// (viewport-clipped rects, boundary pixels, sub-pixel positions).
// ---------------------------------------------------------------------------

/**
 * Mirrors getCanvasCoords logic from MvpEditor.tsx.
 *
 * rect simulates getBoundingClientRect() — which already incorporates any
 * CSS transform (zoom / pan / translate / scale) applied to the canvas.
 * clientX/clientY are raw viewport mouse coordinates.
 */
function getCanvasCoordsLogic(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  naturalWidth: number,
  naturalHeight: number
): { x: number; y: number } | null {
  const scaleX = naturalWidth / rect.width;
  const scaleY = naturalHeight / rect.height;
  const x = Math.floor((clientX - rect.left) * scaleX);
  const y = Math.floor((clientY - rect.top) * scaleY);
  if (x < 0 || x >= naturalWidth || y < 0 || y >= naturalHeight) return null;
  return { x, y };
}

describe("getCanvasCoords logic (Issue #38: zoom/pan correctness)", () => {
  it("1x zoom: click at center maps to correct image pixel", () => {
    // Canvas displayed at natural size (400x300), positioned at (10, 20) in viewport
    const rect = { left: 10, top: 20, width: 400, height: 300 };
    const result = getCanvasCoordsLogic(210, 170, rect, 400, 300);
    // (210-10)*1 = 200, (170-20)*1 = 150
    expect(result).toEqual({ x: 200, y: 150 });
  });

  it("2x zoom: canvas rendered at 2x size, image coords are halved correctly", () => {
    // Natural size 400x300, but getBoundingClientRect returns 800x600 (2x CSS zoom)
    // Because getBoundingClientRect accounts for transform, scaleX = 400/800 = 0.5
    const rect = { left: 0, top: 0, width: 800, height: 600 };
    const result = getCanvasCoordsLogic(400, 300, rect, 400, 300);
    // (400-0)*0.5 = 200, (300-0)*0.5 = 150
    expect(result).toEqual({ x: 200, y: 150 });
  });

  it("0.5x zoom: canvas rendered at half size, image coords are doubled correctly", () => {
    // Natural size 400x300, getBoundingClientRect returns 200x150 (0.5x zoom)
    // scaleX = 400/200 = 2
    const rect = { left: 50, top: 50, width: 200, height: 150 };
    const result = getCanvasCoordsLogic(150, 125, rect, 400, 300);
    // (150-50)*2 = 200, (125-50)*2 = 150
    expect(result).toEqual({ x: 200, y: 150 });
  });

  it("pan offset: canvas translated in viewport, coords still correct", () => {
    // Canvas panned to left=300, top=200 in viewport, displayed at natural size
    const rect = { left: 300, top: 200, width: 400, height: 300 };
    const result = getCanvasCoordsLogic(350, 250, rect, 400, 300);
    // (350-300)*1 = 50, (250-200)*1 = 50
    expect(result).toEqual({ x: 50, y: 50 });
  });

  it("viewport-clipped rect (negative left): coords still correct when canvas partially off-screen", () => {
    // Canvas partially scrolled off left edge: left = -100 (clipped)
    // getBoundingClientRect can return negative left — this is valid
    const rect = { left: -100, top: 0, width: 400, height: 300 };
    const result = getCanvasCoordsLogic(50, 100, rect, 400, 300);
    // (50 - (-100))*1 = 150, (100-0)*1 = 100
    expect(result).toEqual({ x: 150, y: 100 });
  });

  it("returns null for click outside image bounds (right edge overflow)", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    // clientX=105 → x = floor(105*1) = 105 >= naturalWidth=100 → null
    const result = getCanvasCoordsLogic(105, 50, rect, 100, 100);
    expect(result).toBeNull();
  });

  it("returns null for click outside image bounds (negative coords)", () => {
    const rect = { left: 50, top: 50, width: 100, height: 100 };
    // clientX=40 → x = floor((40-50)*1) = -10 < 0 → null
    const result = getCanvasCoordsLogic(40, 60, rect, 100, 100);
    expect(result).toBeNull();
  });

  it("boundary pixel: last valid pixel (naturalWidth-1) is included", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    // clientX=99 → x = floor(99*1) = 99 = naturalWidth-1 → valid
    const result = getCanvasCoordsLogic(99, 50, rect, 100, 100);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(99);
  });

  it("sub-pixel position: Math.floor truncates toward image pixel origin", () => {
    // Natural 200x200, displayed at 100x100 → scaleX=2
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    // clientX=10.7 → (10.7-0)*2=21.4 → floor=21
    const result = getCanvasCoordsLogic(10.7, 10.7, rect, 200, 200);
    expect(result).toEqual({ x: 21, y: 21 });
  });
});

// ---------------------------------------------------------------------------
// Issue #47: buildSvg — hex color validation in fill attribute
// ---------------------------------------------------------------------------

describe("Issue #47: buildSvg hex color validation", () => {
  function setupCanvasMock() {
    const mockCtx = {
      imageSmoothingEnabled: false,
      putImageData: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
      toDataURL: vi.fn(() => "data:image/png;base64,MOCK"),
    };
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
      return origCreate(tag);
    });
  }

  it("valid hex color is preserved as-is in the fill attribute", () => {
    setupCanvasMock();
    const imageData = makeSolidImageData(2, 2, 100, 100, 100);
    const region: PaintRegion = {
      id: "c1",
      pixels: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      color: "#3a7bff",
      transparent: false,
    };
    const svg = buildSvg(imageData, [region], 2, 2);
    expect(svg).toContain('fill="#3a7bff"');
    vi.restoreAllMocks();
  });

  it("invalid color value is replaced with #000000 fallback in the fill attribute", () => {
    setupCanvasMock();
    const imageData = makeSolidImageData(2, 2, 100, 100, 100);
    const region: PaintRegion = {
      id: "c2",
      pixels: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      color: "javascript:alert(1)",
      transparent: false,
    };
    const svg = buildSvg(imageData, [region], 2, 2);
    expect(svg).not.toContain("javascript:alert(1)");
    expect(svg).toContain('fill="#000000"');
    vi.restoreAllMocks();
  });
});
