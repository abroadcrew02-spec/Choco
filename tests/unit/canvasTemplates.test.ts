/**
 * Unit tests for canvas templates (Issue #55).
 *
 * Covers:
 * - CANVAS_TEMPLATES: structure validity (positive dimensions, unique ids)
 * - createBlankImageData: white background fills all pixels correctly
 * - createBlankImageData: transparent background leaves all pixels at rgba(0,0,0,0)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { CANVAS_TEMPLATES, createBlankImageData } from "../../src/components/MvpEditor/lib/canvasTemplates";

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

describe("CANVAS_TEMPLATES", () => {
  it("contains at least one template", () => {
    expect(CANVAS_TEMPLATES.length).toBeGreaterThan(0);
  });

  it("all templates have positive width and height", () => {
    for (const tmpl of CANVAS_TEMPLATES) {
      expect(tmpl.width).toBeGreaterThan(0);
      expect(tmpl.height).toBeGreaterThan(0);
    }
  });

  it("all template ids are unique", () => {
    const ids = CANVAS_TEMPLATES.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all templates have non-empty labelJa, labelEn, hintJa, hintEn", () => {
    for (const tmpl of CANVAS_TEMPLATES) {
      expect(tmpl.labelJa.length).toBeGreaterThan(0);
      expect(tmpl.labelEn.length).toBeGreaterThan(0);
      expect(tmpl.hintJa.length).toBeGreaterThan(0);
      expect(tmpl.hintEn.length).toBeGreaterThan(0);
    }
  });
});

describe("createBlankImageData()", () => {
  // Use a small synthetic template for pixel-iteration tests to keep them fast.
  const SMALL_TMPL = {
    id: "test-small",
    labelJa: "テスト",
    labelEn: "Test",
    width: 4,
    height: 4,
    hintJa: "",
    hintEn: "",
  };

  it("returns ImageData with the correct dimensions", () => {
    const img = createBlankImageData(SMALL_TMPL, "white");
    expect(img.width).toBe(SMALL_TMPL.width);
    expect(img.height).toBe(SMALL_TMPL.height);
  });

  it("white background: all pixels are opaque white (255,255,255,255)", () => {
    const img = createBlankImageData(SMALL_TMPL, "white");
    const { data } = img;
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBe(255);     // R
      expect(data[i + 1]).toBe(255); // G
      expect(data[i + 2]).toBe(255); // B
      expect(data[i + 3]).toBe(255); // A
    }
  });

  it("transparent background: all pixels are fully transparent (0,0,0,0)", () => {
    const img = createBlankImageData(SMALL_TMPL, "transparent");
    const { data } = img;
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBe(0);     // R
      expect(data[i + 1]).toBe(0); // G
      expect(data[i + 2]).toBe(0); // B
      expect(data[i + 3]).toBe(0); // A
    }
  });
});
