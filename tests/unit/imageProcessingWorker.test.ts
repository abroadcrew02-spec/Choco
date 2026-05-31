/**
 * Unit tests for the image-processing Worker API (Issue #54-A).
 *
 * The Worker API wraps pure functions from imageProcessing.ts, so we test:
 *   1. The Worker API module (imageProcessing.worker.ts) by importing its
 *      logic directly — no actual Worker thread is spawned.
 *   2. The getImageProcessingWorker helper's lazy-init and terminate behaviour
 *      by mocking the Worker constructor.
 *
 * jsdom does not support Worker threads, so we avoid creating real Workers
 * in these tests.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import {
  marchingSquaresPath,
  buildSvg,
  type PaintRegion,
} from "../../src/components/MvpEditor/lib/imageProcessing";

// ---------------------------------------------------------------------------
// Polyfills
// ---------------------------------------------------------------------------

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

function makeRgba(
  width: number,
  height: number,
  r = 255,
  g = 0,
  b = 0,
  a = 255
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Worker API logic tests (direct import — no Worker thread)
//
// The Worker wraps marchingSquaresPath and buildSvg. Because these are pure
// functions we can test the Worker's behaviour by calling the underlying
// functions directly, matching the same contract the Worker exposes.
// ---------------------------------------------------------------------------

describe("Worker API: marchingSquaresPath contract", () => {
  it("returns empty path for empty pixel list", () => {
    let usedFallback = false;
    const path = marchingSquaresPath([], () => {
      usedFallback = true;
    });
    expect(path).toBe("");
    expect(usedFallback).toBe(false);
  });

  it("returns a non-empty path for a 2x2 filled region", () => {
    const pixels = [
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 },
    ];
    let usedFallback = false;
    const path = marchingSquaresPath(pixels, () => {
      usedFallback = true;
    });
    expect(path.length).toBeGreaterThan(0);
    expect(path).toContain("M");
    expect(usedFallback).toBe(false);
  });

  it("path output starts with M and ends with Z for a closed polygon", () => {
    // A single-pixel region should produce a closed rect path.
    const pixels = [{ x: 3, y: 3 }];
    let usedFallback = false;
    const path = marchingSquaresPath(pixels, () => {
      usedFallback = true;
    });
    expect(usedFallback).toBe(false);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
  });
});

describe("Worker API: buildSvg contract", () => {
  // jsdom does not support canvas 2D rendering; mock document.createElement
  // so that canvas.getContext("2d") returns a functional stub.
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

  beforeEach(() => {
    setupCanvasMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a valid SVG document string for a 4x4 image with no regions", () => {
    const width = 4;
    const height = 4;
    const rgba = makeRgba(width, height);
    const imageData = new ImageData(rgba, width, height);
    const regions: PaintRegion[] = [];

    let usedFallback = false;
    const svg = buildSvg(imageData, regions, width, height, () => {
      usedFallback = true;
    });

    expect(svg).toContain("<?xml");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(usedFallback).toBe(false);
  });

  it("embeds width and height attributes in the SVG root element", () => {
    const width = 8;
    const height = 6;
    const rgba = makeRgba(width, height);
    const imageData = new ImageData(rgba, width, height);

    const svg = buildSvg(imageData, [], width, height);
    expect(svg).toContain(`width="${width}"`);
    expect(svg).toContain(`height="${height}"`);
  });

  it("includes a <path> element for a color paint region", () => {
    const width = 4;
    const height = 4;
    const rgba = makeRgba(width, height, 200, 200, 200);
    const imageData = new ImageData(rgba, width, height);

    const region: PaintRegion = {
      id: "r1",
      pixels: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      color: "#ff0000",
      transparent: false,
    };

    const svg = buildSvg(imageData, [region], width, height);
    expect(svg).toContain("<path");
    expect(svg).toContain('fill="#ff0000"');
  });

  it("does not include a color <path> for a transparent region", () => {
    const width = 4;
    const height = 4;
    const rgba = makeRgba(width, height, 200, 200, 200);
    const imageData = new ImageData(rgba, width, height);

    const region: PaintRegion = {
      id: "r-trans",
      pixels: [{ x: 1, y: 1 }],
      color: "#000000",
      transparent: true,
    };

    const svg = buildSvg(imageData, [region], width, height);
    // Transparent region creates a mask, not a fill path
    expect(svg).not.toContain('fill="#000000"');
  });
});

// ---------------------------------------------------------------------------
// getImageProcessingWorker: lazy-init and terminate
//
// We mock the Worker constructor and comlink.wrap so no actual Worker is
// created in the jsdom environment.
// ---------------------------------------------------------------------------

describe("getImageProcessingWorker", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("creates a Worker instance on first call", async () => {
    const terminateMock = vi.fn();
    const mockWorkerInstance = { terminate: terminateMock };
    const MockWorker = vi.fn(() => mockWorkerInstance);
    // @ts-expect-error replace global Worker with mock
    globalThis.Worker = MockWorker;

    // Mock comlink.wrap to return a no-op proxy
    vi.mock("comlink", () => ({
      wrap: vi.fn(() => ({})),
      expose: vi.fn(),
    }));

    const { getImageProcessingWorker } = await import(
      "../../src/worker/imageProcessingWorker"
    );
    getImageProcessingWorker();
    expect(MockWorker).toHaveBeenCalledOnce();
  });

  it("terminateImageProcessingWorker calls terminate on the Worker", async () => {
    const terminateMock = vi.fn();
    const mockWorkerInstance = { terminate: terminateMock };
    const MockWorker = vi.fn(() => mockWorkerInstance);
    // @ts-expect-error replace global Worker with mock
    globalThis.Worker = MockWorker;

    vi.mock("comlink", () => ({
      wrap: vi.fn(() => ({})),
      expose: vi.fn(),
    }));

    const { getImageProcessingWorker, terminateImageProcessingWorker } =
      await import("../../src/worker/imageProcessingWorker");

    getImageProcessingWorker();
    terminateImageProcessingWorker();
    expect(terminateMock).toHaveBeenCalledOnce();
  });
});
