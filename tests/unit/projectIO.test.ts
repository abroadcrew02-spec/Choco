import { describe, it, expect } from "vitest";
import {
  parseChocoJson,
  deserializeRegions,
  saveProjectToBlob,
  type ChocoProject,
  type PaintRegionSerialized,
} from "../../src/components/MvpEditor/lib/projectIO";

// ---- helpers ----

function makeProject(overrides: Partial<ChocoProject> = {}): ChocoProject {
  return {
    version: 1,
    image: "data:image/png;base64,abc123",
    imageWidth: 100,
    imageHeight: 80,
    regions: [],
    selectedColor: "#ff0000",
    tolerance: 32,
    brushSize: 20,
    layerVisibility: { background: true, edit: true },
    layerOpacity: { background: 100, edit: 100 },
    ...overrides,
  };
}

// ---- tests ----

describe("parseChocoJson", () => {
  it("round-trips a minimal project through JSON serialization", () => {
    const original = makeProject();
    const json = JSON.stringify(original);
    const parsed = parseChocoJson(json);

    expect(parsed.version).toBe(1);
    expect(parsed.imageWidth).toBe(100);
    expect(parsed.imageHeight).toBe(80);
    expect(parsed.selectedColor).toBe("#ff0000");
    expect(parsed.tolerance).toBe(32);
    expect(parsed.brushSize).toBe(20);
    expect(parsed.layerVisibility).toEqual({ background: true, edit: true });
    expect(parsed.layerOpacity).toEqual({ background: 100, edit: 100 });
  });

  it("round-trips regions with pixel coordinates", () => {
    const regions: PaintRegionSerialized[] = [
      {
        id: "r1",
        pixels: [
          [0, 0],
          [1, 2],
          [10, 20],
        ],
        color: "#00ff00",
        transparent: false,
      },
      {
        id: "r2",
        pixels: [[5, 5]],
        color: "#000000",
        transparent: true,
      },
    ];
    const original = makeProject({ regions });
    const parsed = parseChocoJson(JSON.stringify(original));

    expect(parsed.regions).toHaveLength(2);
    expect(parsed.regions[0].id).toBe("r1");
    expect(parsed.regions[0].pixels).toEqual([
      [0, 0],
      [1, 2],
      [10, 20],
    ]);
    expect(parsed.regions[0].color).toBe("#00ff00");
    expect(parsed.regions[0].transparent).toBe(false);
    expect(parsed.regions[1].transparent).toBe(true);
  });

  it("throws on invalid JSON format (missing version)", () => {
    const bad = JSON.stringify({ imageWidth: 100 });
    expect(() => parseChocoJson(bad)).toThrow("Invalid .choco file format");
  });

  it("throws on non-object JSON", () => {
    expect(() => parseChocoJson('"just a string"')).toThrow(
      "Invalid .choco file format"
    );
  });
});

describe("deserializeRegions", () => {
  it("converts [x,y] pixel arrays to {x,y} objects", () => {
    const serialized: PaintRegionSerialized[] = [
      {
        id: "reg-1",
        pixels: [
          [3, 7],
          [100, 200],
        ],
        color: "#aabbcc",
        transparent: false,
      },
    ];

    const runtime = deserializeRegions(serialized);

    expect(runtime).toHaveLength(1);
    expect(runtime[0].id).toBe("reg-1");
    expect(runtime[0].color).toBe("#aabbcc");
    expect(runtime[0].transparent).toBe(false);
    expect(runtime[0].pixels).toEqual([
      { x: 3, y: 7 },
      { x: 100, y: 200 },
    ]);
  });

  it("handles empty pixel arrays", () => {
    const serialized: PaintRegionSerialized[] = [
      { id: "empty", pixels: [], color: "#ffffff", transparent: true },
    ];
    const runtime = deserializeRegions(serialized);
    expect(runtime[0].pixels).toHaveLength(0);
  });

  it("preserves ordering of multiple regions", () => {
    const serialized: PaintRegionSerialized[] = [
      { id: "a", pixels: [[0, 0]], color: "#ff0000", transparent: false },
      { id: "b", pixels: [[1, 1]], color: "#00ff00", transparent: false },
      { id: "c", pixels: [[2, 2]], color: "#0000ff", transparent: true },
    ];
    const runtime = deserializeRegions(serialized);
    expect(runtime.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("saveProjectToBlob", () => {
  it("produces a Blob with JSON content-type", () => {
    const project = makeProject();
    const { blob } = saveProjectToBlob(project);
    expect(blob.type).toBe("application/json");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("flags warnLarge for payloads over 10 MB", () => {
    // Generate a large image string to exceed 10 MB threshold
    const bigImage = "data:image/png;base64," + "A".repeat(11 * 1024 * 1024);
    const project = makeProject({ image: bigImage });
    const { warnLarge } = saveProjectToBlob(project);
    expect(warnLarge).toBe(true);
  });

  it("does not flag warnLarge for normal-sized projects", () => {
    const project = makeProject();
    const { warnLarge } = saveProjectToBlob(project);
    expect(warnLarge).toBe(false);
  });
});
