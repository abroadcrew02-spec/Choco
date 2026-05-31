import { expose } from "comlink";
import type { ChocoProject, ChocoProjectLite, ProjectState, SerializeOptions } from "../components/MvpEditor/lib/projectIO";

/**
 * Project-serializer Worker API (Issue #62).
 *
 * Offloads serializeProject (including imageDataToPng via OffscreenCanvas)
 * from the main thread so that autosave of large images does not block the UI.
 *
 * Limitation: ImageData cannot be transferred across threads directly in all
 * environments. Callers must pass raw RGBA bytes + dimensions, and this Worker
 * reconstructs ImageData internally before encoding.
 */

// ---------------------------------------------------------------------------
// Internal helpers (Worker-side reimplementations using OffscreenCanvas)
// ---------------------------------------------------------------------------

/**
 * Converts raw RGBA bytes + dimensions to a PNG data URL using OffscreenCanvas.
 * Available in Worker contexts; avoids the main-thread canvas.toDataURL blockage.
 */
async function rgbaToDataUrl(
  rgba: Uint8Array,
  width: number,
  height: number
): Promise<string> {
  const clamped = new Uint8ClampedArray(rgba);
  const imageData = new ImageData(clamped, width, height);
  const offscreen = new OffscreenCanvas(width, height);
  const ctx = offscreen.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);
  const blob = await offscreen.convertToBlob({ type: "image/png" });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("[projectSerializer.worker] FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// Serializable representation of ProjectState (Worker-safe, no ImageData)
// ---------------------------------------------------------------------------

/**
 * Wire format for ProjectState sent to the Worker.
 * ImageData is decomposed into raw bytes + dimensions to allow structured
 * cloning across the Worker boundary.
 */
export interface SerializableProjectState {
  imageRgba: Uint8Array;
  imageWidth: number;
  imageHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  regions: ProjectState["regions"];
  bakeLayerRgba: Uint8Array | null;
  bakeLayerWidth: number | null;
  bakeLayerHeight: number | null;
  selectedColor: string;
  tolerance: number;
}

// ---------------------------------------------------------------------------
// Worker API
// ---------------------------------------------------------------------------

export interface ProjectSerializerApi {
  /**
   * Serializes a project to ChocoProject (full, with PNG images) in the Worker.
   * Image encoding runs on OffscreenCanvas so the main thread stays responsive.
   *
   * @param state   - Serializable project state (ImageData decomposed to RGBA bytes)
   * @param options - SerializeOptions forwarded to the serializer
   */
  serializeProjectInWorker(
    state: SerializableProjectState,
    options?: SerializeOptions
  ): Promise<ChocoProject | ChocoProjectLite>;
}

async function serializeProjectInWorker(
  state: SerializableProjectState,
  options: SerializeOptions = {}
): Promise<ChocoProject | ChocoProjectLite> {
  const includeImage = options.includeImage !== false;

  const serializedRegions = state.regions.map((r) => ({
    id: r.id,
    pixels: r.pixels.map(({ x, y }) => [x, y] as [number, number]),
    color: r.color,
    transparent: r.transparent,
  }));

  const base = {
    version: 1 as const,
    imageWidth: state.naturalWidth,
    imageHeight: state.naturalHeight,
    regions: serializedRegions,
    tool: {
      selectedColor: state.selectedColor,
      tolerance: state.tolerance,
    },
    createdAt: new Date().toISOString(),
  };

  if (!includeImage) {
    return {
      ...base,
      image: null,
      bakeLayer: null,
      imageOmitted: true,
    } as ChocoProjectLite;
  }

  const image = await rgbaToDataUrl(state.imageRgba, state.imageWidth, state.imageHeight);

  let bakeLayer: string | null = null;
  if (state.bakeLayerRgba !== null && state.bakeLayerWidth !== null && state.bakeLayerHeight !== null) {
    bakeLayer = await rgbaToDataUrl(state.bakeLayerRgba, state.bakeLayerWidth, state.bakeLayerHeight);
  }

  return {
    ...base,
    image,
    bakeLayer,
  } as ChocoProject;
}

const api: ProjectSerializerApi = {
  serializeProjectInWorker,
};

expose(api);
