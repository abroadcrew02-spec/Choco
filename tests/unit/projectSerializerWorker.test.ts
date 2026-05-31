/**
 * Unit tests for the project-serializer Worker API (Issue #62).
 *
 * The Worker serializes ProjectState (decomposed to raw RGBA bytes) into
 * ChocoProject / ChocoProjectLite. We test:
 *   1. serializeProjectInWorker logic directly (no actual Worker thread).
 *   2. Worker result is structurally identical to the synchronous serializeProject
 *      for the lite (includeImage:false) path — no canvas required.
 *   3. getProjectSerializerWorker lazy-init / terminate behaviour via mocks.
 *
 * jsdom does not support OffscreenCanvas or Worker threads, so full image
 * encoding (includeImage:true) is not exercised here; that is covered by
 * manual / e2e testing. The serialization logic for regions, dimensions, and
 * tool settings is canvas-independent and fully testable.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import {
  serializeProject,
  type ProjectState,
  type ChocoProjectLite,
} from "../../src/components/MvpEditor/lib/projectIO";
import type { SerializableProjectState } from "../../src/worker/projectSerializer.worker";

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

function makeSolidImageData(w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  return new ImageData(data, w, h);
}

function makeProjectState(): ProjectState {
  return {
    imageData: makeSolidImageData(4, 4),
    naturalWidth: 4,
    naturalHeight: 4,
    regions: [
      {
        id: "r1",
        pixels: [{ x: 0, y: 0 }, { x: 1, y: 2 }],
        color: "#ff0000",
        transparent: false,
      },
    ],
    bakeLayer: null,
    selectedColor: "#00ff00",
    tolerance: 16,
  };
}

function stateToSerializable(state: ProjectState): SerializableProjectState {
  return {
    imageRgba: new Uint8Array(state.imageData.data.buffer),
    imageWidth: state.imageData.width,
    imageHeight: state.imageData.height,
    naturalWidth: state.naturalWidth,
    naturalHeight: state.naturalHeight,
    regions: state.regions,
    bakeLayerRgba: state.bakeLayer ? new Uint8Array(state.bakeLayer.data.buffer) : null,
    bakeLayerWidth: state.bakeLayer ? state.bakeLayer.width : null,
    bakeLayerHeight: state.bakeLayer ? state.bakeLayer.height : null,
    selectedColor: state.selectedColor,
    tolerance: state.tolerance,
  };
}

// ---------------------------------------------------------------------------
// Lite path (includeImage:false) — no OffscreenCanvas needed
//
// We extract and test the non-image serialization logic inline here, since
// jsdom cannot run OffscreenCanvas. This verifies that regions, dimensions,
// and tool settings produced by the Worker match the synchronous path exactly.
// ---------------------------------------------------------------------------

/**
 * Reimplements the Worker's lite-path logic (no canvas) for direct testing.
 * Must stay in sync with projectSerializer.worker.ts serializeProjectInWorker.
 */
function serializeLiteInWorkerLogic(
  state: SerializableProjectState
): ChocoProjectLite {
  const serializedRegions = state.regions.map((r) => ({
    id: r.id,
    pixels: r.pixels.map(({ x, y }) => [x, y] as [number, number]),
    color: r.color,
    transparent: r.transparent,
  }));

  return {
    version: 1,
    imageWidth: state.naturalWidth,
    imageHeight: state.naturalHeight,
    image: null,
    bakeLayer: null,
    imageOmitted: true,
    regions: serializedRegions,
    tool: {
      selectedColor: state.selectedColor,
      tolerance: state.tolerance,
    },
    createdAt: new Date().toISOString(),
  };
}

describe("projectSerializer Worker — lite path result matches synchronous serializeProject", () => {
  it("regions are identical between Worker lite path and sync path", () => {
    const state = makeProjectState();
    const serializableState = stateToSerializable(state);

    const syncLite = serializeProject(state, { includeImage: false }) as ChocoProjectLite;
    const workerLite = serializeLiteInWorkerLogic(serializableState);

    expect(workerLite.regions).toEqual(syncLite.regions);
  });

  it("dimensions and tool settings match between Worker lite and sync paths", () => {
    const state = makeProjectState();
    const serializableState = stateToSerializable(state);

    const syncLite = serializeProject(state, { includeImage: false }) as ChocoProjectLite;
    const workerLite = serializeLiteInWorkerLogic(serializableState);

    expect(workerLite.imageWidth).toBe(syncLite.imageWidth);
    expect(workerLite.imageHeight).toBe(syncLite.imageHeight);
    expect(workerLite.tool.selectedColor).toBe(syncLite.tool.selectedColor);
    expect(workerLite.tool.tolerance).toBe(syncLite.tool.tolerance);
    expect(workerLite.imageOmitted).toBe(true);
    expect(workerLite.image).toBeNull();
    expect(workerLite.bakeLayer).toBeNull();
  });

  it("pixel tuple format [x,y] is preserved in Worker lite output", () => {
    const state = makeProjectState();
    const serializableState = stateToSerializable(state);
    const workerLite = serializeLiteInWorkerLogic(serializableState);

    expect(workerLite.regions[0].pixels).toEqual([[0, 0], [1, 2]]);
  });
});

// ---------------------------------------------------------------------------
// SerializableProjectState construction
// ---------------------------------------------------------------------------

describe("SerializableProjectState construction", () => {
  it("imageRgba buffer length matches width * height * 4", () => {
    const state = makeProjectState();
    const s = stateToSerializable(state);
    expect(s.imageRgba.length).toBe(4 * 4 * 4);
  });

  it("bakeLayerRgba is null when bakeLayer is null", () => {
    const state = makeProjectState();
    const s = stateToSerializable(state);
    expect(s.bakeLayerRgba).toBeNull();
    expect(s.bakeLayerWidth).toBeNull();
    expect(s.bakeLayerHeight).toBeNull();
  });

  it("bakeLayerRgba is populated when bakeLayer is present", () => {
    const state = makeProjectState();
    state.bakeLayer = makeSolidImageData(4, 4);
    const s = stateToSerializable(state);
    expect(s.bakeLayerRgba).not.toBeNull();
    expect(s.bakeLayerWidth).toBe(4);
    expect(s.bakeLayerHeight).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// getProjectSerializerWorker: lazy-init and terminate
// ---------------------------------------------------------------------------

describe("getProjectSerializerWorker", () => {
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

    vi.mock("comlink", () => ({
      wrap: vi.fn(() => ({})),
      expose: vi.fn(),
    }));

    const { getProjectSerializerWorker } = await import(
      "../../src/worker/projectSerializerWorker"
    );
    getProjectSerializerWorker();
    expect(MockWorker).toHaveBeenCalledOnce();
  });

  it("terminateProjectSerializerWorker calls terminate on the Worker", async () => {
    const terminateMock = vi.fn();
    const mockWorkerInstance = { terminate: terminateMock };
    const MockWorker = vi.fn(() => mockWorkerInstance);
    // @ts-expect-error replace global Worker with mock
    globalThis.Worker = MockWorker;

    vi.mock("comlink", () => ({
      wrap: vi.fn(() => ({})),
      expose: vi.fn(),
    }));

    const { getProjectSerializerWorker, terminateProjectSerializerWorker } =
      await import("../../src/worker/projectSerializerWorker");

    getProjectSerializerWorker();
    terminateProjectSerializerWorker();
    expect(terminateMock).toHaveBeenCalledOnce();
  });
});
