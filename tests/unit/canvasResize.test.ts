import { describe, it, expect, beforeAll } from "vitest";
import {
  calcCropOffset,
  cropImageData,
  scaleImageData,
  cropRegion,
  scaleRegion,
} from "../../src/components/MvpEditor/lib/canvasResize";
import type { PaintRegion } from "../../src/components/MvpEditor/MvpEditor";

// jsdom does not implement ImageData — polyfill
beforeAll(() => {
  if (typeof ImageData === "undefined") {
    // @ts-expect-error polyfill
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
// Helper
// ---------------------------------------------------------------------------

function makeSolid(w: number, h: number, r: number, g: number, b: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, w, h);
}

function makeRegion(pixels: { x: number; y: number }[]): PaintRegion {
  return { id: "r1", pixels, color: "#ff0000", transparent: false };
}

// ---------------------------------------------------------------------------
// calcCropOffset
// ---------------------------------------------------------------------------

describe("calcCropOffset", () => {
  it("top-left yields (0, 0) for any sizes", () => {
    const { offsetX, offsetY } = calcCropOffset(100, 100, 200, 200, "top-left");
    expect(offsetX).toBe(0);
    expect(offsetY).toBe(0);
  });

  it("middle-center centers the old image in the new canvas", () => {
    const { offsetX, offsetY } = calcCropOffset(100, 60, 200, 120, "middle-center");
    expect(offsetX).toBe(50);
    expect(offsetY).toBe(30);
  });

  it("bottom-right positions old image at the bottom-right corner", () => {
    const { offsetX, offsetY } = calcCropOffset(80, 40, 200, 100, "bottom-right");
    expect(offsetX).toBe(120); // 200 - 80
    expect(offsetY).toBe(60);  // 100 - 40
  });

  it("negative offset when new canvas is smaller than old (crop left side)", () => {
    // old 200×200 into new 100×100 centered: offset = -50
    const { offsetX, offsetY } = calcCropOffset(200, 200, 100, 100, "middle-center");
    expect(offsetX).toBe(-50);
    expect(offsetY).toBe(-50);
  });
});

// ---------------------------------------------------------------------------
// cropImageData
// ---------------------------------------------------------------------------

describe("cropImageData", () => {
  it("expanding with top-left anchor fills new area with transparent", () => {
    const src = makeSolid(2, 2, 255, 0, 0);
    const dst = cropImageData(src, 4, 4, "top-left");
    expect(dst.width).toBe(4);
    expect(dst.height).toBe(4);
    // top-left 2×2 should be red
    expect(dst.data[0]).toBe(255);
    expect(dst.data[1]).toBe(0);
    expect(dst.data[3]).toBe(255);
    // pixel at (3,3) should be transparent
    const idx = (3 * 4 + 3) * 4;
    expect(dst.data[idx + 3]).toBe(0);
  });

  it("shrinking with top-left anchor crops bottom-right", () => {
    // 4×4 red, crop to 2×2 from top-left
    const src = makeSolid(4, 4, 200, 100, 50);
    const dst = cropImageData(src, 2, 2, "top-left");
    expect(dst.width).toBe(2);
    expect(dst.height).toBe(2);
    // all 4 pixels should be same color as src
    for (let i = 0; i < 4; i++) {
      expect(dst.data[i * 4]).toBe(200);
      expect(dst.data[i * 4 + 3]).toBe(255);
    }
  });
});

// ---------------------------------------------------------------------------
// scaleImageData
// ---------------------------------------------------------------------------

describe("scaleImageData", () => {
  it("scales a 2×2 image to 4×4 (nearest neighbor)", () => {
    const src = makeSolid(2, 2, 0, 128, 255);
    const dst = scaleImageData(src, 4, 4);
    expect(dst.width).toBe(4);
    expect(dst.height).toBe(4);
    // all pixels should preserve the source color
    for (let i = 0; i < 16; i++) {
      expect(dst.data[i * 4 + 1]).toBe(128);
    }
  });

  it("scales a 4×4 image to 2×2 (downscale)", () => {
    const src = makeSolid(4, 4, 10, 20, 30);
    const dst = scaleImageData(src, 2, 2);
    expect(dst.width).toBe(2);
    expect(dst.height).toBe(2);
    for (let i = 0; i < 4; i++) {
      expect(dst.data[i * 4]).toBe(10);
      expect(dst.data[i * 4 + 2]).toBe(30);
    }
  });
});

// ---------------------------------------------------------------------------
// cropRegion
// ---------------------------------------------------------------------------

describe("cropRegion", () => {
  it("removes pixels outside new bounds", () => {
    const region = makeRegion([
      { x: 0, y: 0 },
      { x: 3, y: 3 }, // will be out-of-bounds for 3×3 new canvas
    ]);
    const result = cropRegion(region, 10, 10, 3, 3, "top-left");
    expect(result.pixels.length).toBe(1);
    expect(result.pixels[0]).toEqual({ x: 0, y: 0 });
  });

  it("shifts pixels by anchor offset", () => {
    // old 4×4, new 8×8, centered: offset = +2
    const region = makeRegion([{ x: 0, y: 0 }]);
    const result = cropRegion(region, 4, 4, 8, 8, "middle-center");
    expect(result.pixels[0]).toEqual({ x: 2, y: 2 });
  });
});

// ---------------------------------------------------------------------------
// scaleRegion
// ---------------------------------------------------------------------------

describe("scaleRegion", () => {
  it("scales pixel coordinates proportionally", () => {
    const region = makeRegion([{ x: 1, y: 1 }]);
    // old 4×4 → new 8×8: scale = 2
    const result = scaleRegion(region, 4, 4, 8, 8);
    expect(result.pixels[0]).toEqual({ x: 2, y: 2 });
  });

  it("deduplicates pixels that map to same destination", () => {
    // old 4×4 → new 2×2: scale = 0.5, pixels (0,0) and (1,0) both map to (0,0)
    const region = makeRegion([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    const result = scaleRegion(region, 4, 4, 2, 2);
    expect(result.pixels.length).toBe(1);
    expect(result.pixels[0]).toEqual({ x: 0, y: 0 });
  });
});
