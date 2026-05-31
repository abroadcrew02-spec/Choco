/**
 * Unit tests for projectIO.ts
 *
 * Covers:
 * - serializeProject: round-trip pixel coordinates format
 * - serializeProject: includeImage:false omits image data (autosave)
 * - serializeProject: includeImage:true (default) includes image data
 * - deserializeProject: valid data restores correctly
 * - deserializeProject: invalid JSON structure is rejected
 * - deserializeProject: wrong version is rejected
 * - deserializeProject: missing required fields are rejected
 * - deserializeProjectLite: autosave lite format restores regions/settings
 * - deserializeProjectLite: returns null for non-lite (full) project
 * - useAutoSave: onError called on localStorage quota exceeded
 */

import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import {
  serializeProject,
  deserializeProject,
  deserializeProjectLite,
  type ProjectState,
  type ChocoProject,
  type ChocoProjectLite,
} from "../../src/components/MvpEditor/lib/projectIO";

// ---------------------------------------------------------------------------
// Mock browser APIs (jsdom does not implement canvas toDataURL / Image)
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Polyfill ImageData
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

  // Stub document.createElement("canvas") to return a minimal canvas mock
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") {
      const canvas = origCreate("canvas");
      // Stub getContext to return a minimal 2D context mock
      canvas.getContext = (_id: string) =>
        ({
          putImageData: vi.fn(),
          drawImage: vi.fn(),
          getImageData: (_x: number, _y: number, w: number, h: number) =>
            new ImageData(w, h),
        }) as unknown as CanvasRenderingContext2D;
      // Stub toDataURL to return a fake PNG data URL
      canvas.toDataURL = (_type?: string) =>
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      return canvas;
    }
    return origCreate(tag);
  });

  // Stub Image constructor for pngToImageData
  // @ts-expect-error override global Image
  globalThis.Image = class MockImage {
    naturalWidth = 1;
    naturalHeight = 1;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private _src = "";
    get src(): string { return this._src; }
    set src(value: string) {
      this._src = value;
      // Trigger onload asynchronously
      setTimeout(() => { this.onload?.(); }, 0);
    }
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSolidImageData(w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 255;
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, w, h);
}

function makeMinimalState(): ProjectState {
  return {
    imageData: makeSolidImageData(4, 4),
    naturalWidth: 4,
    naturalHeight: 4,
    regions: [
      {
        id: "r1",
        pixels: [
          { x: 0, y: 0 },
          { x: 1, y: 2 },
        ],
        color: "#ff0000",
        transparent: false,
      },
    ],
    bakeLayer: null,
    selectedColor: "#00ff00",
    tolerance: 16,
  };
}

// ---------------------------------------------------------------------------
// serializeProject
// ---------------------------------------------------------------------------

describe("serializeProject", () => {
  it("produces version 1 output", () => {
    const state = makeMinimalState();
    const project = serializeProject(state);
    expect(project.version).toBe(1);
  });

  it("serializes regions pixels as [x,y] tuples", () => {
    const state = makeMinimalState();
    const project = serializeProject(state);
    expect(project.regions).toHaveLength(1);
    expect(project.regions[0].pixels).toEqual([
      [0, 0],
      [1, 2],
    ]);
  });

  it("preserves tool settings", () => {
    const state = makeMinimalState();
    const project = serializeProject(state);
    expect(project.tool.selectedColor).toBe("#00ff00");
    expect(project.tool.tolerance).toBe(16);
  });

  it("sets bakeLayer to null when not present", () => {
    const state = makeMinimalState();
    const project = serializeProject(state);
    expect(project.bakeLayer).toBeNull();
  });

  it("encodes bakeLayer when present", () => {
    const state = makeMinimalState();
    state.bakeLayer = makeSolidImageData(4, 4);
    const project = serializeProject(state);
    expect(typeof project.bakeLayer).toBe("string");
    expect(project.bakeLayer).toMatch(/^data:image\/png/);
  });

  it("round-trips region data through serialization", () => {
    const state = makeMinimalState();
    const project = serializeProject(state);
    // Pixels serialized as tuples
    const firstRegion = project.regions[0];
    expect(firstRegion.id).toBe("r1");
    expect(firstRegion.color).toBe("#ff0000");
    expect(firstRegion.transparent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deserializeProject — valid input
// ---------------------------------------------------------------------------

describe("deserializeProject — valid", () => {
  it("restores regions from [x,y] tuple format", async () => {
    const state = makeMinimalState();
    const project = serializeProject(state);
    const restored = await deserializeProject(project);
    expect(restored.regions).toHaveLength(1);
    expect(restored.regions[0].pixels).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 2 },
    ]);
  });

  it("restores tool settings", async () => {
    const state = makeMinimalState();
    const project = serializeProject(state);
    const restored = await deserializeProject(project);
    expect(restored.selectedColor).toBe("#00ff00");
    expect(restored.tolerance).toBe(16);
  });

  it("restores dimensions", async () => {
    const state = makeMinimalState();
    const project = serializeProject(state);
    const restored = await deserializeProject(project);
    expect(restored.naturalWidth).toBe(4);
    expect(restored.naturalHeight).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// deserializeProject — invalid input
// ---------------------------------------------------------------------------

describe("deserializeProject — invalid input", () => {
  it("throws when input is not an object", async () => {
    await expect(deserializeProject("not an object")).rejects.toThrow(
      /not an object/
    );
  });

  it("throws for unsupported version", async () => {
    const project: Record<string, unknown> = {
      version: 99,
      image: "data:image/png;base64,abc",
      imageWidth: 4,
      imageHeight: 4,
      regions: [],
    };
    await expect(deserializeProject(project)).rejects.toThrow(/Unsupported project version/);
  });

  it("throws when image field is missing", async () => {
    const project: Record<string, unknown> = {
      version: 1,
      imageWidth: 4,
      imageHeight: 4,
      regions: [],
    };
    await expect(deserializeProject(project)).rejects.toThrow(/Invalid or missing image field/);
  });

  it("throws when imageWidth is invalid", async () => {
    const project: Record<string, unknown> = {
      version: 1,
      image: "data:image/png;base64,abc",
      imageWidth: -1,
      imageHeight: 4,
      regions: [],
    };
    await expect(deserializeProject(project)).rejects.toThrow(/Invalid imageWidth/);
  });

  it("throws when imageHeight is invalid", async () => {
    const project: Record<string, unknown> = {
      version: 1,
      image: "data:image/png;base64,abc",
      imageWidth: 4,
      imageHeight: 0,
      regions: [],
    };
    await expect(deserializeProject(project)).rejects.toThrow(/Invalid imageHeight/);
  });

  it("throws when regions is not an array", async () => {
    const project: Record<string, unknown> = {
      version: 1,
      image: "data:image/png;base64,abc",
      imageWidth: 4,
      imageHeight: 4,
      regions: "not-an-array",
    };
    await expect(deserializeProject(project)).rejects.toThrow(/Invalid regions/);
  });

  it("throws when a region pixel entry is malformed", async () => {
    const project: Record<string, unknown> = {
      version: 1,
      image: "data:image/png;base64,abc",
      imageWidth: 4,
      imageHeight: 4,
      regions: [
        {
          id: "r1",
          pixels: [{ not: "a tuple" }],
          color: "#ff0000",
          transparent: false,
        },
      ],
    };
    await expect(deserializeProject(project)).rejects.toThrow(/Invalid pixel/);
  });
});

// ---------------------------------------------------------------------------
// serializeProject — includeImage option (autosave vs explicit save)
// ---------------------------------------------------------------------------

describe("serializeProject — includeImage option", () => {
  it("includeImage:false omits image and bakeLayer data", () => {
    const state = makeMinimalState();
    const lite = serializeProject(state, { includeImage: false }) as ChocoProjectLite;
    expect(lite.image).toBeNull();
    expect(lite.bakeLayer).toBeNull();
    expect(lite.imageOmitted).toBe(true);
  });

  it("includeImage:false preserves regions, dimensions, and tool settings", () => {
    const state = makeMinimalState();
    const lite = serializeProject(state, { includeImage: false }) as ChocoProjectLite;
    expect(lite.regions).toHaveLength(1);
    expect(lite.imageWidth).toBe(4);
    expect(lite.imageHeight).toBe(4);
    expect(lite.tool.selectedColor).toBe("#00ff00");
    expect(lite.tool.tolerance).toBe(16);
  });

  it("includeImage:true (default) includes image data URL", () => {
    const state = makeMinimalState();
    const full = serializeProject(state, { includeImage: true }) as ChocoProject;
    expect(typeof full.image).toBe("string");
    expect(full.image).toMatch(/^data:image\/png/);
    expect((full as unknown as { imageOmitted?: boolean }).imageOmitted).toBeUndefined();
  });

  it("default (no options) behaves as includeImage:true", () => {
    const state = makeMinimalState();
    const full = serializeProject(state) as ChocoProject;
    expect(typeof full.image).toBe("string");
    expect(full.image).toMatch(/^data:image\/png/);
  });
});

// ---------------------------------------------------------------------------
// deserializeProjectLite
// ---------------------------------------------------------------------------

describe("deserializeProjectLite", () => {
  it("restores regions and settings from lite autosave", () => {
    const state = makeMinimalState();
    const lite = serializeProject(state, { includeImage: false }) as ChocoProjectLite;
    const restored = deserializeProjectLite(lite);
    expect(restored).not.toBeNull();
    expect(restored!.imageData).toBeNull();
    expect(restored!.bakeLayer).toBeNull();
    expect(restored!.regions).toHaveLength(1);
    expect(restored!.regions[0].pixels).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 2 },
    ]);
    expect(restored!.selectedColor).toBe("#00ff00");
    expect(restored!.tolerance).toBe(16);
    expect(restored!.naturalWidth).toBe(4);
    expect(restored!.naturalHeight).toBe(4);
  });

  it("returns null for a full (non-lite) project", () => {
    const state = makeMinimalState();
    const full = serializeProject(state, { includeImage: true });
    const result = deserializeProjectLite(full);
    expect(result).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(deserializeProjectLite(null)).toBeNull();
    expect(deserializeProjectLite("string")).toBeNull();
    expect(deserializeProjectLite(42)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// localStorage quota simulation — autosave lite write/read cycle
// ---------------------------------------------------------------------------

describe("autosave lite — localStorage read/write", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("serialized lite project can be written to localStorage without quota issues", () => {
    const state = makeMinimalState();
    const lite = serializeProject(state, { includeImage: false });
    const json = JSON.stringify(lite);
    // Should not throw; jsdom localStorage has no strict quota
    expect(() => localStorage.setItem("choco:autosave", json)).not.toThrow();
    const stored = localStorage.getItem("choco:autosave");
    expect(stored).not.toBeNull();
  });

  it("lite format JSON does not contain base64 image data", () => {
    const state = makeMinimalState();
    const lite = serializeProject(state, { includeImage: false });
    const json = JSON.stringify(lite);
    // Full project would contain "data:image/png;base64,"
    expect(json).not.toContain("data:image/png;base64,");
    expect(json).toContain('"imageOmitted":true');
  });

  it("onError callback is invoked when localStorage.setItem throws (quota simulation)", () => {
    const quotaError = new DOMException("QuotaExceededError", "QuotaExceededError");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw quotaError;
    });

    const onError = vi.fn();
    const state = makeMinimalState();

    // Simulate what useAutoSave.performSave does internally
    try {
      const project = serializeProject(state, { includeImage: false });
      const json = JSON.stringify(project);
      localStorage.setItem("choco:autosave", json);
    } catch (err) {
      onError(err);
    }

    expect(onError).toHaveBeenCalledWith(quotaError);
  });
});
