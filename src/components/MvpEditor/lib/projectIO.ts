/**
 * projectIO.ts
 *
 * Serialize / deserialize the Choco editor state to/from the .choco project
 * file format (JSON with base64-encoded PNG image data).
 *
 * File format version 1:
 * {
 *   version: 1,
 *   image: "data:image/png;base64,...",       // base ImageData as PNG data URL
 *   bakeLayer: "data:image/png;base64,...",   // bakeLayer (optional, null if absent)
 *   imageWidth: number,
 *   imageHeight: number,
 *   regions: SerializedRegion[],             // PaintRegion[] with pixels as [x, y][] tuples
 *   tool: {
 *     selectedColor: string,
 *     tolerance: number,
 *   },
 *   createdAt: string,                        // ISO 8601 timestamp
 * }
 */

import type { PaintRegion } from "../MvpEditor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SerializedRegion {
  id: string;
  pixels: [number, number][];
  color: string;
  transparent: boolean;
}

export interface ChocoProject {
  version: 1;
  image: string;
  bakeLayer: string | null;
  imageWidth: number;
  imageHeight: number;
  regions: SerializedRegion[];
  tool: {
    selectedColor: string;
    tolerance: number;
  };
  createdAt: string;
}

export interface ProjectState {
  imageData: ImageData;
  naturalWidth: number;
  naturalHeight: number;
  regions: PaintRegion[];
  bakeLayer: ImageData | null;
  selectedColor: string;
  tolerance: number;
}

// ---------------------------------------------------------------------------
// ImageData <-> PNG data URL (browser-only, requires canvas)
// ---------------------------------------------------------------------------

/**
 * Converts ImageData to a PNG data URL synchronously using an offscreen canvas.
 * Logs a warning for large images (> 4M pixels) due to potential UI blocking.
 */
function imageDataToPng(imageData: ImageData): string {
  if (imageData.width * imageData.height > 4_000_000) {
    console.warn(
      "[projectIO] Large image detected (" +
        imageData.width +
        "x" +
        imageData.height +
        "). localStorage save may block the UI briefly."
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Loads a PNG data URL into an ImageData using an offscreen canvas.
 * Returns a Promise because Image.onload is async.
 */
function pngToImageData(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight));
    };
    img.onerror = () => reject(new Error("[projectIO] Failed to load image data URL"));
    img.src = dataUrl;
  });
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/**
 * Serializes the current editor state to a ChocoProject object.
 * The base imageData and optional bakeLayer are encoded as PNG data URLs.
 */
export function serializeProject(state: ProjectState): ChocoProject {
  const serializedRegions: SerializedRegion[] = state.regions.map((r) => ({
    id: r.id,
    pixels: r.pixels.map(({ x, y }) => [x, y] as [number, number]),
    color: r.color,
    transparent: r.transparent,
  }));

  return {
    version: 1,
    image: imageDataToPng(state.imageData),
    bakeLayer: state.bakeLayer ? imageDataToPng(state.bakeLayer) : null,
    imageWidth: state.naturalWidth,
    imageHeight: state.naturalHeight,
    regions: serializedRegions,
    tool: {
      selectedColor: state.selectedColor,
      tolerance: state.tolerance,
    },
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Deserialize
// ---------------------------------------------------------------------------

/**
 * Validates and deserializes a parsed JSON object into a ProjectState.
 * Throws an Error with a descriptive message if validation fails.
 *
 * This function loads image data asynchronously (canvas Image decode).
 */
export async function deserializeProject(
  raw: unknown
): Promise<ProjectState> {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("[projectIO] Invalid project: not an object");
  }

  const obj = raw as Record<string, unknown>;

  // Version check
  if (obj["version"] !== 1) {
    throw new Error(
      "[projectIO] Unsupported project version: " + String(obj["version"])
    );
  }

  // Image data URL
  if (typeof obj["image"] !== "string" || !obj["image"].startsWith("data:image/")) {
    throw new Error("[projectIO] Invalid or missing image field");
  }

  // Dimensions
  if (typeof obj["imageWidth"] !== "number" || obj["imageWidth"] <= 0) {
    throw new Error("[projectIO] Invalid imageWidth");
  }
  if (typeof obj["imageHeight"] !== "number" || obj["imageHeight"] <= 0) {
    throw new Error("[projectIO] Invalid imageHeight");
  }

  // Regions
  if (!Array.isArray(obj["regions"])) {
    throw new Error("[projectIO] Invalid regions: not an array");
  }

  const regions: PaintRegion[] = (obj["regions"] as unknown[]).map((r, i) => {
    if (typeof r !== "object" || r === null) {
      throw new Error("[projectIO] Invalid region at index " + i);
    }
    const region = r as Record<string, unknown>;
    if (typeof region["id"] !== "string") {
      throw new Error("[projectIO] Invalid region id at index " + i);
    }
    if (!Array.isArray(region["pixels"])) {
      throw new Error("[projectIO] Invalid region pixels at index " + i);
    }
    if (typeof region["color"] !== "string") {
      throw new Error("[projectIO] Invalid region color at index " + i);
    }
    if (typeof region["transparent"] !== "boolean") {
      throw new Error("[projectIO] Invalid region transparent at index " + i);
    }

    const pixels = (region["pixels"] as unknown[]).map((p, pi) => {
      if (!Array.isArray(p) || p.length < 2) {
        throw new Error("[projectIO] Invalid pixel at region " + i + " index " + pi);
      }
      return { x: p[0] as number, y: p[1] as number };
    });

    return {
      id: region["id"] as string,
      pixels,
      color: region["color"] as string,
      transparent: region["transparent"] as boolean,
    };
  });

  // Tool settings (optional with defaults)
  const toolRaw =
    typeof obj["tool"] === "object" && obj["tool"] !== null
      ? (obj["tool"] as Record<string, unknown>)
      : {};
  const selectedColor =
    typeof toolRaw["selectedColor"] === "string" ? toolRaw["selectedColor"] : "#ff0000";
  const tolerance =
    typeof toolRaw["tolerance"] === "number" ? toolRaw["tolerance"] : 32;

  // Load image data asynchronously
  const imageData = await pngToImageData(obj["image"] as string);

  // Load bakeLayer if present
  let bakeLayer: ImageData | null = null;
  if (typeof obj["bakeLayer"] === "string" && obj["bakeLayer"].startsWith("data:image/")) {
    bakeLayer = await pngToImageData(obj["bakeLayer"]);
  }

  return {
    imageData,
    naturalWidth: obj["imageWidth"] as number,
    naturalHeight: obj["imageHeight"] as number,
    regions,
    bakeLayer,
    selectedColor,
    tolerance,
  };
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

/**
 * Triggers a .choco file download in the browser.
 */
export function downloadChocoFile(project: ChocoProject, filename = "project.choco"): void {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Opens a file picker and reads a .choco file as text.
 * Returns the parsed JSON object or throws on parse error.
 */
export function openChocoFile(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".choco,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error("[projectIO] No file selected"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string);
          resolve(parsed);
        } catch {
          reject(new Error("[projectIO] Failed to parse .choco file as JSON"));
        }
      };
      reader.onerror = () => reject(new Error("[projectIO] Failed to read file"));
      reader.readAsText(file);
    };
    input.click();
  });
}
