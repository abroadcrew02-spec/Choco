import { useRef, useState, useCallback, useEffect } from "react";
import {
  Paintbrush,
  PaintBucket,
  Eraser,
  Pipette,
  Replace,
  Undo2,
  Redo2,
  FolderOpen,
  Maximize2,
  FileCode2,
  Download,
  Wand2,
} from "lucide-react";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useZoomPan } from "./hooks/useZoomPan";
import { HsvPicker } from "./components/HsvPicker";
import { Tooltip } from "./components/Tooltip";
import { Toast, type ToastMessage } from "./components/Toast";
import { ShortcutHelp } from "./components/ShortcutHelp";

// ---------------------------------------------------------------------------
// Design tokens — Professional Dark Studio
// ---------------------------------------------------------------------------

const T = {
  color: {
    bgBase:      "#141414",
    bgPanel:     "#1c1c1c",
    bgElevated:  "#242424",
    border:      "rgba(255,255,255,0.08)",
    borderMid:   "rgba(255,255,255,0.14)",
    textPrimary: "#e8e8e8",
    textMuted:   "#888",
    textDim:     "#666",
    accent:      "#4f8ef7",
    accentHover: "#6aa3ff",
    danger:      "#e05555",
    dangerDark:  "#7a1a1a",
    success:     "#4caf7d",
    overlay:     "rgba(0,0,0,0.6)",
    overlayMid:  "rgba(0,0,0,0.5)",
    checkerA:    "#2a2a2a",
    checkerB:    "#1e1e1e",
    swatchRemoveBg: "#600",
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const,
  radius: { sm: 4, md: 6, lg: 10 } as const,
  shadow: {
    panel:    "0 1px 3px rgba(0,0,0,0.4)",
    elevated: "0 4px 16px rgba(0,0,0,0.6)",
  },
  font: {
    family: "'Inter','Noto Sans JP',system-ui,sans-serif",
    label:  11,
    body:   13,
    badge:  10,
  },
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaintRegion {
  id: string;
  pixels: { x: number; y: number }[];
  color: string;
  transparent: boolean;
}

interface BaseState {
  imageData: ImageData | null;
  naturalWidth: number;
  naturalHeight: number;
}

type EditorMode = "color" | "transparent" | "eyedropper" | "replace-all" | "brush";

// Brand swatches stored in LocalStorage
const BRAND_SWATCHES_KEY = "choco_brand_swatches";
const BRAND_SWATCHES_MAX = 8;

// Recent colors — in-memory only, max 8
const RECENT_COLORS_MAX = 8;

function loadBrandSwatches(): string[] {
  try {
    const raw = localStorage.getItem(BRAND_SWATCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "string");
    return [];
  } catch {
    return [];
  }
}

function saveBrandSwatches(swatches: string[]): void {
  try {
    localStorage.setItem(BRAND_SWATCHES_KEY, JSON.stringify(swatches));
  } catch {
    // ignore quota errors
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_COLOR = "#ff0000";
const DEFAULT_TOLERANCE = 32;
const SVG_TARGET_LONG_EDGE = 2048;
const ACCEPTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".svg", ".gif"];
const PALETTE_BUCKETS = 32; // quantization step per channel

// ---------------------------------------------------------------------------
// Pure utility functions (exported for testing)
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function colorDistance(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number
): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * Flood fill selection. Returns the set of pixel coordinates reachable from
 * (startX, startY) within the given color tolerance.
 *
 * connectivity: 4 (default) = cardinal neighbors only;
 *               8 = include diagonal neighbors (B-3).
 * antialiasMode: "normal" (default) = strict color distance check;
 *                "antialias" = also include pixels with near-matching hue
 *                              and alpha < 255 (B-2 boundary inclusion).
 */
export function floodFillSelect(
  imageData: ImageData,
  startX: number,
  startY: number,
  tolerance: number,
  antialiasMode: "normal" | "antialias" = "normal",
  connectivity: 4 | 8 = 4
): { x: number; y: number }[] {
  const { width, height, data } = imageData;
  const startIdx = (startY * width + startX) * 4;
  const startR = data[startIdx];
  const startG = data[startIdx + 1];
  const startB = data[startIdx + 2];

  const visited = new Uint8Array(width * height);
  const result: { x: number; y: number }[] = [];
  const stack: number[] = [startY * width + startX];
  visited[startY * width + startX] = 1;

  // Neighbor offsets for 4-neighbor vs 8-neighbor connectivity
  const neighbors4 = [
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
  ];
  const neighbors8 = [
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
    { dx: -1, dy: -1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
  ];
  const neighborOffsets = connectivity === 8 ? neighbors8 : neighbors4;

  while (stack.length > 0) {
    const idx = stack.pop()!;
    const x = idx % width;
    const y = Math.floor(idx / width);
    const pixelIdx = idx * 4;

    const r = data[pixelIdx];
    const g = data[pixelIdx + 1];
    const b = data[pixelIdx + 2];
    const a = data[pixelIdx + 3];

    const dist = colorDistance(r, g, b, startR, startG, startB);

    // Normal check: strict color distance
    const matchesNormal = dist <= tolerance;
    // Antialias check: near-matching hue AND semi-transparent (boundary pixel)
    const matchesAntialias =
      antialiasMode === "antialias" && dist <= tolerance * 2 && a < 255;

    if (!matchesNormal && !matchesAntialias) continue;

    result.push({ x, y });

    for (const { dx, dy } of neighborOffsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      stack.push(nIdx);
    }
  }

  return result;
}

/**
 * Selects all pixels in the image whose color is within tolerance of the
 * pixel at (startX, startY), regardless of connectivity.
 */
export function replaceAllSelect(
  imageData: ImageData,
  startX: number,
  startY: number,
  tolerance: number
): { x: number; y: number }[] {
  const { width, height, data } = imageData;
  const startIdx = (startY * width + startX) * 4;
  const startR = data[startIdx];
  const startG = data[startIdx + 1];
  const startB = data[startIdx + 2];

  const result: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (colorDistance(r, g, b, startR, startG, startB) <= tolerance) {
        result.push({ x, y });
      }
    }
  }
  return result;
}

/**
 * Picks the RGB color of a single pixel from ImageData.
 * Returns [r, g, b] or null if out of bounds.
 */
export function pickPixelColor(
  imageData: ImageData,
  x: number,
  y: number
): [number, number, number] | null {
  const { width, height, data } = imageData;
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  const idx = (y * width + x) * 4;
  return [data[idx], data[idx + 1], data[idx + 2]];
}

/**
 * Extracts up to `count` dominant colors from ImageData using histogram
 * quantization (each channel bucketed to PALETTE_BUCKETS steps).
 */
export function extractPaletteColors(
  imageData: ImageData,
  count: number
): string[] {
  const { width, height, data } = imageData;
  const bucketMap = new Map<number, number>();
  const step = PALETTE_BUCKETS;

  for (let i = 0; i < width * height; i++) {
    const r = Math.floor(data[i * 4] / step) * step;
    const g = Math.floor(data[i * 4 + 1] / step) * step;
    const b = Math.floor(data[i * 4 + 2] / step) * step;
    const a = data[i * 4 + 3];
    if (a < 128) continue; // skip mostly-transparent pixels
    const key = (r << 16) | (g << 8) | b;
    bucketMap.set(key, (bucketMap.get(key) ?? 0) + 1);
  }

  const sorted = [...bucketMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count);

  return sorted.map(([key]) => {
    const r = (key >> 16) & 0xff;
    const g = (key >> 8) & 0xff;
    const b = key & 0xff;
    return rgbToHex(r, g, b);
  });
}

/**
 * Applies all paint regions to the base imageData and returns composited ImageData.
 * No layer opacity/visibility — regions are directly applied on top of base.
 *
 * If bakeLayer is provided, it is alpha-composited on top of the region result.
 * bakeLayer pixels with alpha=0 are transparent (no-op). This is used for
 * direct pixel painting (brush tool) without destroying the non-destructive
 * PaintRegion history.
 */
export function compositeRegions(
  baseImageData: ImageData,
  regions: PaintRegion[],
  bakeLayer?: ImageData | null
): ImageData {
  const { width, height } = baseImageData;
  const resultData = new Uint8ClampedArray(baseImageData.data);

  for (const region of regions) {
    if (region.transparent) {
      for (const { x, y } of region.pixels) {
        const idx = (y * width + x) * 4;
        resultData[idx + 3] = 0;
      }
    } else {
      const [r, g, b] = hexToRgb(region.color);
      for (const { x, y } of region.pixels) {
        const idx = (y * width + x) * 4;
        resultData[idx] = r;
        resultData[idx + 1] = g;
        resultData[idx + 2] = b;
        resultData[idx + 3] = 255;
      }
    }
  }

  // Alpha-composite bakeLayer on top (straight-alpha blending, bakeLayer is src)
  if (bakeLayer && bakeLayer.width === width && bakeLayer.height === height) {
    const bakeData = bakeLayer.data;
    for (let i = 0; i < width * height; i++) {
      const k = i * 4;
      const bakeA = bakeData[k + 3];
      if (bakeA === 0) continue;
      if (bakeA === 255) {
        resultData[k] = bakeData[k];
        resultData[k + 1] = bakeData[k + 1];
        resultData[k + 2] = bakeData[k + 2];
        resultData[k + 3] = 255;
      } else {
        const alpha = bakeA / 255;
        const invAlpha = 1 - alpha;
        resultData[k] = Math.round(resultData[k] * invAlpha + bakeData[k] * alpha);
        resultData[k + 1] = Math.round(resultData[k + 1] * invAlpha + bakeData[k + 1] * alpha);
        resultData[k + 2] = Math.round(resultData[k + 2] * invAlpha + bakeData[k + 2] * alpha);
        resultData[k + 3] = Math.min(255, resultData[k + 3] + bakeA);
      }
    }
  }

  return new ImageData(resultData, width, height);
}

/**
 * Selects all pixels globally within tolerance of the clicked pixel's color,
 * then applies smooth or hard color replacement.
 *
 * Returns a new ImageData with replaced pixels (does not mutate input).
 *
 * smoothReplace=true: blend factor a = 1 - sqrt(dist) / (repTol * 2)
 *   produces a soft gradient at the selection boundary.
 * smoothReplace=false: hard replacement for all pixels within tolerance.
 */
export function smoothReplaceAll(
  imageData: ImageData,
  startX: number,
  startY: number,
  tolerance: number,
  newColor: [number, number, number],
  smoothReplace: boolean
): ImageData {
  const { width, height, data } = imageData;
  const startIdx = (startY * width + startX) * 4;
  const r0 = data[startIdx];
  const g0 = data[startIdx + 1];
  const b0 = data[startIdx + 2];
  const [fr, fg, fb] = newColor;

  const resultData = new Uint8ClampedArray(data);
  const t2 = tolerance * tolerance * 4;
  const denom = tolerance * 2;

  for (let i = 0; i < width * height; i++) {
    const k = i * 4;
    const dr = resultData[k] - r0;
    const dg = resultData[k + 1] - g0;
    const db = resultData[k + 2] - b0;
    const dist2 = dr * dr + dg * dg + db * db;
    if (dist2 > t2) continue;

    if (!smoothReplace) {
      resultData[k] = fr;
      resultData[k + 1] = fg;
      resultData[k + 2] = fb;
    } else {
      const a = denom > 0 ? Math.max(0, Math.min(1, 1 - Math.sqrt(dist2) / denom)) : 1;
      if (a > 0) {
        resultData[k] = Math.round(resultData[k] * (1 - a) + fr * a);
        resultData[k + 1] = Math.round(resultData[k + 1] * (1 - a) + fg * a);
        resultData[k + 2] = Math.round(resultData[k + 2] * (1 - a) + fb * a);
      }
    }
  }

  return new ImageData(resultData, width, height);
}

/**
 * Returns a deep copy of the given ImageData.
 */
function copyImageData(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

/**
 * Converts ImageData to a PNG data URL via an offscreen canvas.
 */
function imageDataToPngDataUrl(imageData: ImageData, scale = 1): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width * scale;
  canvas.height = imageData.height * scale;
  const ctx = canvas.getContext("2d")!;
  if (scale > 1) {
    ctx.imageSmoothingEnabled = false;
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = imageData.width;
    tmpCanvas.height = imageData.height;
    const tmpCtx = tmpCanvas.getContext("2d")!;
    tmpCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(tmpCanvas, 0, 0, imageData.width * scale, imageData.height * scale);
  } else {
    ctx.putImageData(imageData, 0, 0);
  }
  return canvas.toDataURL("image/png");
}

/**
 * Builds an SVG path string (d attribute) from a set of pixel coordinates
 * using marching squares boundary tracing.
 *
 * Each connected boundary is emitted as a sub-path ("M ... Z").
 * Holes are represented as additional sub-paths with opposite winding (SVG
 * even-odd fill rule handles cutouts automatically).
 *
 * The algorithm pads each pixel by one unit so adjacent pixels merge into
 * filled rectangles rather than individual 1×1 squares.
 */
export function marchingSquaresPath(pixels: { x: number; y: number }[]): string {
  if (pixels.length === 0) return "";

  // Build a fast lookup set using (y * maxPossibleWidth + x) key
  // We use a string-based Set for simplicity and correctness across large images
  const pixelSet = new Set<string>(pixels.map((p) => `${p.x},${p.y}`));

  function has(x: number, y: number): boolean {
    return pixelSet.has(`${x},${y}`);
  }

  // Marching squares: collect all horizontal and vertical edge segments
  // An edge exists where the inside/outside status changes between adjacent cells.
  // We collect axis-aligned unit edges, then chain them into closed loops.

  // Horizontal edges: top edge of pixel (x,y) if (x,y) is inside and (x,y-1) is outside,
  //                   bottom edge of pixel (x,y) if (x,y) is inside and (x,y+1) is outside.
  // Vertical edges:   left edge of pixel (x,y) if (x,y) is inside and (x-1,y) is outside,
  //                   right edge of pixel (x,y) if (x,y) is inside and (x+1,y) is outside.

  // Edge representation: each edge is from point A to point B (integer grid corners).
  // We store edges in a map: startPoint -> [endPoint, ...]

  // Grid corners are at integer coordinates. Pixel (x,y) occupies the square
  // from corner (x,y) to corner (x+1,y+1).

  interface Point { x: number; y: number }
  type EdgeMap = Map<string, Point[]>;

  const edgeMap: EdgeMap = new Map();

  function addEdge(ax: number, ay: number, bx: number, by: number): void {
    const key = `${ax},${ay}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.push({ x: bx, y: by });
    } else {
      edgeMap.set(key, [{ x: bx, y: by }]);
    }
  }

  for (const { x, y } of pixels) {
    // Top edge: from (x,y) to (x+1,y)  — exists when (x,y-1) is outside
    if (!has(x, y - 1)) addEdge(x, y, x + 1, y);
    // Bottom edge: from (x+1,y+1) to (x,y+1) — exists when (x,y+1) is outside
    if (!has(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
    // Left edge: from (x,y+1) to (x,y) — exists when (x-1,y) is outside
    if (!has(x - 1, y)) addEdge(x, y + 1, x, y);
    // Right edge: from (x+1,y) to (x+1,y+1) — exists when (x+1,y) is outside
    if (!has(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
  }

  // Trace closed loops from the edge map
  const pathParts: string[] = [];
  const visitedEdgeKeys = new Set<string>();

  for (const [startKey, _] of edgeMap) {
    if (visitedEdgeKeys.has(startKey)) continue;

    // Start a new loop from this point
    const firstPtParts = startKey.split(",");
    const firstPt: Point = { x: Number(firstPtParts[0]), y: Number(firstPtParts[1]) };

    const loopPoints: Point[] = [firstPt];
    let current = firstPt;
    let loopClosed = false;

    for (let step = 0; step < edgeMap.size + 4; step++) {
      const key = `${current.x},${current.y}`;
      const nexts = edgeMap.get(key);
      if (!nexts || nexts.length === 0) break;

      const next = nexts[0];

      // Remove the used edge
      nexts.splice(0, 1);
      if (nexts.length === 0) edgeMap.delete(key);

      visitedEdgeKeys.add(key);

      if (next.x === firstPt.x && next.y === firstPt.y) {
        loopClosed = true;
        break;
      }

      loopPoints.push(next);
      current = next;
    }

    if (loopPoints.length >= 2) {
      const d = loopPoints
        .map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`)
        .join(" ");
      pathParts.push(loopClosed ? d + " Z" : d);
    }
  }

  return pathParts.join(" ");
}

/**
 * Builds an SVG with pixel-accurate color regions, using vector <path>
 * elements for color regions (via marching squares boundary tracing) and
 * a <mask> for transparent regions.
 *
 * The base image is embedded as a PNG <image>. Color regions are rendered
 * as filled <path> elements with fill-rule="evenodd" to handle holes.
 * Transparent regions cut holes via an SVG <mask>.
 */
export function buildSvg(
  imageData: ImageData,
  regions: PaintRegion[],
  width: number,
  height: number
): string {
  const baseDataUrl = imageDataToPngDataUrl(imageData);

  const transparentPixels = regions
    .filter((r) => r.transparent)
    .flatMap((r) => r.pixels);

  const maskRects =
    transparentPixels.length > 0
      ? transparentPixels
          .map((p) => `    <rect x="${p.x}" y="${p.y}" width="1" height="1" fill="black" />`)
          .join("\n")
      : "";

  const maskSection =
    maskRects.length > 0
      ? `  <mask id="transparentMask">
    <rect width="${width}" height="${height}" fill="white" />
${maskRects}
  </mask>`
      : "";

  const imageElement =
    maskRects.length > 0
      ? `  <image href="${baseDataUrl}" width="${width}" height="${height}" mask="url(#transparentMask)" />`
      : `  <image href="${baseDataUrl}" width="${width}" height="${height}" />`;

  const colorElements = regions
    .filter((r) => !r.transparent && r.pixels.length > 0)
    .map((region) => {
      const d = marchingSquaresPath(region.pixels);
      if (!d) return "";
      return `  <path d="${d}" fill="${region.color}" fill-rule="evenodd" />`;
    })
    .filter(Boolean)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${maskSection}
${imageElement}
${colorElements}
</svg>`;
}

/**
 * Applies "transparent white" to all pixels in imageData whose color
 * is within tolerance of pure white (#ffffff). Returns a new ImageData.
 * Uses the same color-distance metric as floodFillSelect.
 */
export function makeWhiteTransparent(
  imageData: ImageData,
  tolerance = 5
): { pixels: { x: number; y: number }[] } {
  const { width, height, data } = imageData;
  const result: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (colorDistance(r, g, b, 255, 255, 255) <= tolerance) {
        result.push({ x, y });
      }
    }
  }
  return { pixels: result };
}

/**
 * Closes small holes in a binary pixel selection mask using morphological
 * closing (dilate then erode). Ported from logo_recolor_4.html closeMask().
 *
 * @param pixels - Array of selected pixel coordinates (mutated in place)
 * @param width  - Image width in pixels
 * @param height - Image height in pixels
 * @param radius - Number of dilation/erosion passes (0 = no-op)
 * @returns New array of pixel coordinates after closing
 */
export function closeMask(
  pixels: { x: number; y: number }[],
  width: number,
  height: number,
  radius: number
): { x: number; y: number }[] {
  if (radius <= 0 || pixels.length === 0) return pixels;

  // Build binary mask from pixel list
  let cur = new Uint8Array(width * height);
  for (const { x, y } of pixels) {
    cur[y * width + x] = 1;
  }

  // Dilate: r passes
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (cur[y * width + x]) {
          next[y * width + x] = 1;
          continue;
        }
        if (
          (x > 0 && cur[y * width + x - 1]) ||
          (x < width - 1 && cur[y * width + x + 1]) ||
          (y > 0 && cur[(y - 1) * width + x]) ||
          (y < height - 1 && cur[(y + 1) * width + x])
        ) {
          next[y * width + x] = 1;
        }
      }
    }
    cur = next;
  }

  // Erode: r passes
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!cur[y * width + x]) continue;
        if (
          (x > 0 && !cur[y * width + x - 1]) ||
          (x < width - 1 && !cur[y * width + x + 1]) ||
          (y > 0 && !cur[(y - 1) * width + x]) ||
          (y < height - 1 && !cur[(y + 1) * width + x])
        ) {
          continue;
        }
        next[y * width + x] = 1;
      }
    }
    cur = next;
  }

  // Convert back to pixel array
  const result: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (cur[y * width + x]) result.push({ x, y });
    }
  }
  return result;
}

/**
 * 2-pass box blur approximation of a Gaussian blur on a Float32 mask.
 * Ported from logo_recolor_4.html blurMask().
 *
 * @param src    - Input mask as Float32Array or Uint8Array (values 0–1 or 0–255 normalized)
 * @param w      - Image width
 * @param h      - Image height
 * @param r      - Blur radius in pixels (0 = no-op)
 * @returns New Float32Array with blurred values in [0, 1]
 */
export function blurMask(
  src: Float32Array | Uint8Array,
  w: number,
  h: number,
  r: number
): Float32Array {
  if (r <= 0) {
    const out = new Float32Array(w * h);
    for (let i = 0; i < src.length; i++) out[i] = src[i];
    return out;
  }

  function singlePass(input: Float32Array): Float32Array {
    const tmp = new Float32Array(w * h);
    const dst = new Float32Array(w * h);
    // Horizontal pass
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = 0; x < r; x++) sum += input[y * w + x];
      for (let x = 0; x < w; x++) {
        if (x + r < w) sum += input[y * w + x + r];
        if (x - r - 1 >= 0) sum -= input[y * w + x - r - 1];
        tmp[y * w + x] = sum / (Math.min(x + r + 1, w) - Math.max(0, x - r));
      }
    }
    // Vertical pass
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = 0; y < r; y++) sum += tmp[y * w + x];
      for (let y = 0; y < h; y++) {
        if (y + r < h) sum += tmp[(y + r) * w + x];
        if (y - r - 1 >= 0) sum -= tmp[(y - r - 1) * w + x];
        dst[y * w + x] = sum / (Math.min(y + r + 1, h) - Math.max(0, y - r));
      }
    }
    return dst;
  }

  // Build Float32 input from src
  const input = new Float32Array(w * h);
  for (let i = 0; i < src.length; i++) input[i] = src[i];

  // Two passes for smoother Gaussian approximation
  const pass1 = singlePass(input);
  const pass2 = singlePass(pass1);
  return pass2;
}

/**
 * Applies feathered (blurred) color fill to an ImageData using a binary pixel mask.
 * When feather > 0, the mask is blurred so that the fill blends softly at the boundary.
 * When feather = 0, hard pixel replacement is used.
 *
 * Returns a new ImageData (does not mutate input).
 */
export function applyFeatheredFill(
  imageData: ImageData,
  pixels: { x: number; y: number }[],
  newColor: [number, number, number],
  featherRadius: number,
  transparent = false
): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data);

  if (featherRadius <= 0) {
    // Hard fill
    const [r, g, b] = newColor;
    for (const { x, y } of pixels) {
      const k = (y * width + x) * 4;
      if (transparent) {
        resultData[k + 3] = 0;
      } else {
        resultData[k] = r;
        resultData[k + 1] = g;
        resultData[k + 2] = b;
        resultData[k + 3] = 255;
      }
    }
    return new ImageData(resultData, width, height);
  }

  // Build binary mask
  const mask = new Float32Array(width * height);
  for (const { x, y } of pixels) {
    mask[y * width + x] = 1;
  }

  // Blur mask
  const blurred = blurMask(mask, width, height, featherRadius);

  const [fr, fg, fb] = newColor;
  for (let i = 0; i < width * height; i++) {
    const a = blurred[i];
    if (a <= 0) continue;
    const k = i * 4;
    if (transparent) {
      resultData[k + 3] = Math.max(0, Math.round(resultData[k + 3] * (1 - a)));
    } else {
      resultData[k] = Math.round(resultData[k] * (1 - a) + fr * a);
      resultData[k + 1] = Math.round(resultData[k + 1] * (1 - a) + fg * a);
      resultData[k + 2] = Math.round(resultData[k + 2] * (1 - a) + fb * a);
      resultData[k + 3] = Math.min(255, Math.round(resultData[k + 3] + (255 - resultData[k + 3]) * a));
    }
  }

  return new ImageData(resultData, width, height);
}

/**
 * Rewrites an SVG string so its rendered size has a long edge of
 * SVG_TARGET_LONG_EDGE pixels, preserving aspect ratio.
 */
function rewriteSvgForHighResRasterize(svgText: string): {
  text: string;
  width: number;
  height: number;
} {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;

  let aspectW = 1;
  let aspectH = 1;

  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/);
    if (parts.length === 4) {
      const vbW = parseFloat(parts[2]);
      const vbH = parseFloat(parts[3]);
      if (vbW > 0 && vbH > 0) {
        aspectW = vbW;
        aspectH = vbH;
      }
    }
  } else {
    const attrW = parseFloat(svg.getAttribute("width") ?? "0");
    const attrH = parseFloat(svg.getAttribute("height") ?? "0");
    if (attrW > 0 && attrH > 0) {
      aspectW = attrW;
      aspectH = attrH;
    }
  }

  let targetW: number;
  let targetH: number;
  if (aspectW >= aspectH) {
    targetW = SVG_TARGET_LONG_EDGE;
    targetH = Math.round((aspectH / aspectW) * SVG_TARGET_LONG_EDGE);
  } else {
    targetH = SVG_TARGET_LONG_EDGE;
    targetW = Math.round((aspectW / aspectH) * SVG_TARGET_LONG_EDGE);
  }

  svg.setAttribute("width", String(targetW));
  svg.setAttribute("height", String(targetH));

  const serialized = new XMLSerializer().serializeToString(doc);
  return { text: serialized, width: targetW, height: targetH };
}

/**
 * Returns true if the file should be accepted as an image based on
 * MIME type or file extension (C-2 fix: extension fallback for WebView2).
 */
export function isAcceptedImageFile(file: { type: string; name: string }): boolean {
  if (file.type.startsWith("image/")) return true;
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DEFAULT_BRUSH_SIZE = 15;

export function MvpEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [baseState, setBaseState] = useState<BaseState>({
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
  });

  const regionHistory = useUndoRedo<PaintRegion[]>([]);
  const regions = regionHistory.current;

  // bakeLayer: transparent ImageData that accumulates direct pixel painting (brush).
  // Stored as a ref to avoid re-render on every stroke tick.
  // bakeLayerHistory mirrors regionHistory for Undo/Redo synchronization.
  const bakeLayerRef = useRef<ImageData | null>(null);
  const bakeLayerHistoryRef = useRef<(ImageData | null)[]>([null]);
  const bakeLayerHistoryIndexRef = useRef<number>(0);

  // Brush stroke state
  const brushDrawingRef = useRef<boolean>(false);
  const brushLastPosRef = useRef<{ x: number; y: number } | null>(null);
  // Offscreen canvas used for current stroke accumulation
  const strokeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [mode, setMode] = useState<EditorMode>("color");
  const [selectedColor, setSelectedColor] = useState(DEFAULT_COLOR);
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [smoothReplace, setSmoothReplace] = useState(false);
  const [status, setStatus] = useState("画像を読み込んでください");
  const [spacePressed, setSpacePressed] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);
  const [palette, setPalette] = useState<string[]>([]);
  const [pngScale, setPngScale] = useState<1 | 2 | 4>(1);
  const [showMapping, setShowMapping] = useState(true);
  const [showPalette, setShowPalette] = useState(true);
  // B-2: brand color swatches
  const [brandSwatches, setBrandSwatches] = useState<string[]>(loadBrandSwatches);
  // B-2: antialias boundary inclusion
  const [includeAntialias, setIncludeAntialias] = useState(false);
  // B-3: connectivity mode (4-neighbor vs 8-neighbor)
  const [connectivity, setConnectivity] = useState<4 | 8>(4);
  // B-3: before/after comparison mode (show base without regions)
  const [comparing, setComparing] = useState(false);

  // S2: HSV picker popup open/closed
  const [hsvPickerOpen, setHsvPickerOpen] = useState(false);
  // S2: hole-fill radius (0 = OFF, 1-5)
  const [closeRadius, setCloseRadius] = useState(0);

  // S3: feather radius (0 = no blur, 1-20)
  const [featherRadius, setFeatherRadius] = useState(0);

  // S3: recent colors (in-memory, up to 8, most recent first)
  const [recentColors, setRecentColors] = useState<string[]>([]);

  // S3: toast notification
  const [currentToast, setCurrentToast] = useState<ToastMessage | null>(null);
  const toastIdRef = useRef(0);

  // S3: shortcut help popover
  const [shortcutPos, setShortcutPos] = useState<{ x: number; y: number } | null>(null);

  // Ref for the color swatch button (to position the HSV picker)
  const colorSwatchRef = useRef<HTMLButtonElement>(null);

  const zoom = useZoomPan(spacePressed);

  // ---------------------------------------------------------------------------
  // S3: Toast helper
  // ---------------------------------------------------------------------------

  const showToast = useCallback((message: string, type: ToastMessage["type"] = "success") => {
    toastIdRef.current += 1;
    setCurrentToast({ message, type, id: toastIdRef.current });
  }, []);

  // ---------------------------------------------------------------------------
  // S3: Recent colors helper
  // ---------------------------------------------------------------------------

  const addRecentColor = useCallback((hex: string) => {
    setRecentColors((prev) => {
      const normalized = hex.toLowerCase();
      const filtered = prev.filter((c) => c.toLowerCase() !== normalized);
      return [hex, ...filtered].slice(0, RECENT_COLORS_MAX);
    });
  }, []);

  // Trigger an explicit canvas redraw without changing React state for regions.
  // Used by brush strokes (which mutate bakeLayerRef directly) and Undo/Redo.
  const [redrawTick, setRedrawTick] = useState(0);
  const triggerRedraw = useCallback(() => {
    setRedrawTick((n) => n + 1);
  }, []);

  // ---------------------------------------------------------------------------
  // bakeLayer helpers
  // ---------------------------------------------------------------------------

  /**
   * Pushes the current bakeLayer into bakeLayerHistory in sync with regionHistory.
   * Call this whenever regionHistory.push() is called.
   */
  const pushBakeSnapshot = useCallback((snapshot: ImageData | null) => {
    const HISTORY_LIMIT = 10;
    const idx = bakeLayerHistoryIndexRef.current;
    const hist = bakeLayerHistoryRef.current;
    const truncated = hist.slice(0, idx + 1);
    const next = [...truncated, snapshot ? copyImageData(snapshot) : null];
    const sliced = next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
    bakeLayerHistoryRef.current = sliced;
    bakeLayerHistoryIndexRef.current = sliced.length - 1;
  }, []);

  const undoBakeSnapshot = useCallback(() => {
    const idx = bakeLayerHistoryIndexRef.current;
    if (idx > 0) {
      bakeLayerHistoryIndexRef.current = idx - 1;
      const snapshot = bakeLayerHistoryRef.current[idx - 1];
      bakeLayerRef.current = snapshot ? copyImageData(snapshot) : null;
    }
  }, []);

  const redoBakeSnapshot = useCallback(() => {
    const idx = bakeLayerHistoryIndexRef.current;
    const hist = bakeLayerHistoryRef.current;
    if (idx < hist.length - 1) {
      bakeLayerHistoryIndexRef.current = idx + 1;
      const snapshot = hist[idx + 1];
      bakeLayerRef.current = snapshot ? copyImageData(snapshot) : null;
    }
  }, []);

  const resetBakeHistory = useCallback(() => {
    bakeLayerRef.current = null;
    bakeLayerHistoryRef.current = [null];
    bakeLayerHistoryIndexRef.current = 0;
  }, []);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts: Ctrl+Z, Ctrl+Y, Ctrl+0, Space, I, R, B
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        regionHistory.undo();
        undoBakeSnapshot();
        triggerRedraw();
        setStatus("元に戻しました");
        return;
      }
      if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
        e.preventDefault();
        regionHistory.redo();
        redoBakeSnapshot();
        triggerRedraw();
        setStatus("やり直しました");
        return;
      }
      if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        const container = containerRef.current;
        if (container && baseState.naturalWidth > 0) {
          zoom.fitToContainer(
            container.clientWidth,
            container.clientHeight,
            baseState.naturalWidth,
            baseState.naturalHeight
          );
        }
        return;
      }
      // Ctrl+V: paste image from clipboard (B-1)
      if (e.ctrlKey && e.key === "v") {
        e.preventDefault();
        handleClipboardPaste();
        return;
      }
      // B = brush
      if (!e.ctrlKey && !e.altKey && e.key === "b") {
        setMode("brush");
        return;
      }
      // I = eyedropper
      if (!e.ctrlKey && !e.altKey && e.key === "i") {
        setMode("eyedropper");
        return;
      }
      // R = replace-all
      if (!e.ctrlKey && !e.altKey && e.key === "r") {
        setMode("replace-all");
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionHistory, baseState.naturalWidth, baseState.naturalHeight, zoom, undoBakeSnapshot, redoBakeSnapshot, triggerRedraw]);

  // ---------------------------------------------------------------------------
  // Canvas redraw
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !baseState.imageData) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (comparing) {
      // B-3: before/after comparison — show raw base image without regions
      ctx.putImageData(baseState.imageData, 0, 0);
    } else {
      const composited = compositeRegions(baseState.imageData, regions, bakeLayerRef.current);
      ctx.putImageData(composited, 0, 0);
    }
  // redrawTick is intentionally included so brush strokes (ref mutations) trigger redraws
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseState, regions, comparing, redrawTick]);

  // ---------------------------------------------------------------------------
  // Image loading
  // ---------------------------------------------------------------------------

  const loadImageFromFile = useCallback(
    (file: File) => {
      const isSvg =
        file.type === "image/svg+xml" ||
        file.name.toLowerCase().endsWith(".svg");

      if (isSvg) {
        const reader = new FileReader();
        reader.onload = () => {
          const svgText = reader.result as string;
          let rewritten: ReturnType<typeof rewriteSvgForHighResRasterize>;
          try {
            rewritten = rewriteSvgForHighResRasterize(svgText);
          } catch {
            setStatus("SVGの解析に失敗しました");
            return;
          }
          const { text, width: w, height: h } = rewritten;
          const blob = new Blob([text], { type: "image/svg+xml" });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            const offscreen = document.createElement("canvas");
            offscreen.width = w;
            offscreen.height = h;
            const ctx = offscreen.getContext("2d")!;
            ctx.drawImage(img, 0, 0, w, h);
            const imageData = ctx.getImageData(0, 0, w, h);
            URL.revokeObjectURL(url);
            setBaseState({ imageData, naturalWidth: w, naturalHeight: h });
            regionHistory.reset([]);
            resetBakeHistory();
            setPalette(extractPaletteColors(imageData, 8));
            setStatus(`画像読み込み完了: ${w}x${h}`);
            // B-1: auto-fit on load
            requestAnimationFrame(() => {
              const container = containerRef.current;
              if (container) zoom.fitToContainer(container.clientWidth, container.clientHeight, w, h);
            });
          };
          img.onerror = () => {
            setStatus("SVG画像の読み込みに失敗しました");
            URL.revokeObjectURL(url);
          };
          img.src = url;
        };
        reader.onerror = () => setStatus("ファイルの読み込みに失敗しました");
        reader.readAsText(file);
        return;
      }

      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const offscreen = document.createElement("canvas");
        offscreen.width = w;
        offscreen.height = h;
        const ctx = offscreen.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, w, h);
        URL.revokeObjectURL(url);
        setBaseState({ imageData, naturalWidth: w, naturalHeight: h });
        regionHistory.reset([]);
        resetBakeHistory();
        setPalette(extractPaletteColors(imageData, 8));
        setStatus(`画像読み込み完了: ${w}x${h}`);
        // B-1: auto-fit on load
        requestAnimationFrame(() => {
          const container = containerRef.current;
          if (container) zoom.fitToContainer(container.clientWidth, container.clientHeight, w, h);
        });
      };
      img.onerror = () => {
        setStatus("画像の読み込みに失敗しました");
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
    [regionHistory, zoom, resetBakeHistory]
  );

  // C-2 fix: accept by MIME type OR file extension fallback
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && isAcceptedImageFile(file)) {
        loadImageFromFile(file);
      }
    },
    [loadImageFromFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadImageFromFile(file);
      e.target.value = "";
    },
    [loadImageFromFile]
  );

  // ---------------------------------------------------------------------------
  // Canvas coordinate helper
  // ---------------------------------------------------------------------------

  const getCanvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas || !baseState.imageData) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = baseState.naturalWidth / rect.width;
      const scaleY = baseState.naturalHeight / rect.height;
      const x = Math.floor((e.clientX - rect.left) * scaleX);
      const y = Math.floor((e.clientY - rect.top) * scaleY);
      if (x < 0 || x >= baseState.naturalWidth || y < 0 || y >= baseState.naturalHeight)
        return null;
      return { x, y };
    },
    [baseState]
  );

  // ---------------------------------------------------------------------------
  // Canvas interactions
  // ---------------------------------------------------------------------------

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!baseState.imageData) return;
      const coords = getCanvasCoords(e);
      if (!coords) {
        setHoverInfo(null);
        return;
      }
      const { x, y } = coords;
      const rgb = pickPixelColor(baseState.imageData, x, y);
      if (!rgb) {
        setHoverInfo(null);
        return;
      }
      const [r, g, b] = rgb;
      const hex = rgbToHex(r, g, b).toUpperCase();
      setHoverInfo(`X: ${x}, Y: ${y} | ${hex} (${r}, ${g}, ${b})`);
    },
    [baseState, getCanvasCoords]
  );

  const handleCanvasMouseLeave = useCallback(() => {
    setHoverInfo(null);
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (spacePressed) return;
      if (!baseState.imageData) return;
      // brush mode uses mousedown/mousemove/mouseup, not click
      if (mode === "brush") return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      const { x, y } = coords;

      // Eyedropper mode: pick color and switch back to color mode
      if (mode === "eyedropper") {
        const rgb = pickPixelColor(baseState.imageData, x, y);
        if (!rgb) return;
        const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
        setSelectedColor(hex);
        addRecentColor(hex);
        setMode("color");
        setStatus(`スポイト: ${hex.toUpperCase()} を選択`);
        return;
      }

      // Replace-all mode: smooth or hard global color replacement
      if (mode === "replace-all") {
        if (smoothReplace) {
          // smoothReplace modifies pixels directly; store result in bakeLayer
          const newColor = hexToRgb(selectedColor);
          const newImageData = smoothReplaceAll(
            compositeRegions(baseState.imageData, regions, bakeLayerRef.current),
            x, y, tolerance, newColor, true
          );
          // Store the result as an updated bakeLayer that encodes the full visual state.
          // Strategy: bake current regions+bake into a new bakeLayer snapshot,
          // then apply smooth replace on top of it.
          // Since smoothReplace produces a new ImageData (base-relative), we store
          // it as a "full bake" by diffing against base.
          const w = baseState.naturalWidth;
          const h = baseState.naturalHeight;
          const newBake = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
          const srcData = newImageData.data;
          const bakeData = newBake.data;
          for (let i = 0; i < w * h * 4; i++) {
            bakeData[i] = srcData[i];
          }
          bakeLayerRef.current = newBake;
          pushBakeSnapshot(newBake);
          regionHistory.push([...regions]);
          triggerRedraw();
          addRecentColor(selectedColor);
          setStatus(`滑らか置換 → ${selectedColor}`);
          return;
        }
        let replacePixels = replaceAllSelect(baseState.imageData, x, y, tolerance);
        if (replacePixels.length === 0) return;
        if (closeRadius > 0) {
          replacePixels = closeMask(replacePixels, baseState.naturalWidth, baseState.naturalHeight, closeRadius);
        }

        // S3: apply feather if featherRadius > 0
        if (featherRadius > 0) {
          const composited = compositeRegions(baseState.imageData, regions, bakeLayerRef.current);
          const newColor = hexToRgb(selectedColor);
          const feathered = applyFeatheredFill(composited, replacePixels, newColor, featherRadius, false);
          const w = baseState.naturalWidth;
          const hh = baseState.naturalHeight;
          const newBake2 = new ImageData(new Uint8ClampedArray(w * hh * 4), w, hh);
          const srcData = feathered.data;
          const bakeData2 = newBake2.data;
          for (let idx2 = 0; idx2 < w * hh * 4; idx2++) bakeData2[idx2] = srcData[idx2];
          bakeLayerRef.current = newBake2;
          pushBakeSnapshot(newBake2);
          regionHistory.push([...regions]);
          triggerRedraw();
          addRecentColor(selectedColor);
          setStatus(`一括置換 (フェザー${featherRadius}): ${replacePixels.length}px → ${selectedColor}`);
          return;
        }

        const newRegion: PaintRegion = {
          id: `region-${Date.now()}`,
          pixels: replacePixels,
          color: selectedColor,
          transparent: false,
        };
        pushBakeSnapshot(bakeLayerRef.current);
        regionHistory.push([...regions, newRegion]);
        addRecentColor(selectedColor);
        setStatus(`一括置換: ${replacePixels.length}px → ${selectedColor}`);
        return;
      }

      // Color / transparent mode: flood fill (with optional 8-neighbor connectivity)
      let pixels = floodFillSelect(
        baseState.imageData, x, y, tolerance,
        includeAntialias ? "antialias" : "normal",
        connectivity
      );
      if (pixels.length === 0) return;

      // Apply hole-fill (closeRadius > 0)
      if (closeRadius > 0) {
        pixels = closeMask(pixels, baseState.naturalWidth, baseState.naturalHeight, closeRadius);
      }

      // S3: apply feather if featherRadius > 0
      if (featherRadius > 0) {
        const composited = compositeRegions(baseState.imageData, regions, bakeLayerRef.current);
        const newColor = hexToRgb(selectedColor);
        const feathered = applyFeatheredFill(composited, pixels, newColor, featherRadius, mode === "transparent");
        const w2 = baseState.naturalWidth;
        const h2 = baseState.naturalHeight;
        const newBakeF = new ImageData(new Uint8ClampedArray(w2 * h2 * 4), w2, h2);
        const srcDataF = feathered.data;
        const bakeDataF = newBakeF.data;
        for (let idxF = 0; idxF < w2 * h2 * 4; idxF++) bakeDataF[idxF] = srcDataF[idxF];
        bakeLayerRef.current = newBakeF;
        pushBakeSnapshot(newBakeF);
        regionHistory.push([...regions]);
        triggerRedraw();
        if (mode !== "transparent") addRecentColor(selectedColor);
        setStatus(
          mode === "transparent"
            ? `透過 (フェザー${featherRadius}): ${pixels.length}px`
            : `色変更 (フェザー${featherRadius}): ${pixels.length}px → ${selectedColor}`
        );
        return;
      }

      const newRegion: PaintRegion = {
        id: `region-${Date.now()}`,
        pixels,
        color: selectedColor,
        transparent: mode === "transparent",
      };

      pushBakeSnapshot(bakeLayerRef.current);
      regionHistory.push([...regions, newRegion]);
      if (mode !== "transparent") addRecentColor(selectedColor);
      setStatus(
        mode === "transparent"
          ? `透過: ${pixels.length}px 選択`
          : `色変更: ${pixels.length}px → ${selectedColor}`
      );
    },
    [baseState, tolerance, selectedColor, mode, spacePressed, regions, regionHistory, getCanvasCoords, includeAntialias, connectivity, smoothReplace, closeRadius, featherRadius, pushBakeSnapshot, triggerRedraw, addRecentColor]
  );

  // ---------------------------------------------------------------------------
  // Brush stroke handlers
  // ---------------------------------------------------------------------------

  const handleBrushMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode !== "brush" || spacePressed || !baseState.imageData) return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      const { x, y } = coords;
      const w = baseState.naturalWidth;
      const h = baseState.naturalHeight;

      // Initialize bakeLayer if not yet created
      if (!bakeLayerRef.current) {
        bakeLayerRef.current = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
      }

      // Initialize stroke offscreen canvas
      if (!strokeCanvasRef.current ||
          strokeCanvasRef.current.width !== w ||
          strokeCanvasRef.current.height !== h) {
        const sc = document.createElement("canvas");
        sc.width = w;
        sc.height = h;
        strokeCanvasRef.current = sc;
      }
      const sc = strokeCanvasRef.current;
      const sctx = sc.getContext("2d")!;
      sctx.clearRect(0, 0, w, h);

      brushDrawingRef.current = true;
      brushLastPosRef.current = { x, y };

      // Draw initial dot
      sctx.fillStyle = selectedColor;
      sctx.beginPath();
      sctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      sctx.fill();

      // Merge stroke canvas into bakeLayer
      mergeBrushStroke(w, h);
      triggerRedraw();
    },
    [mode, spacePressed, baseState, getCanvasCoords, selectedColor, brushSize, triggerRedraw]
  );

  const handleBrushMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!brushDrawingRef.current || mode !== "brush" || !baseState.imageData) return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      const { x, y } = coords;
      const last = brushLastPosRef.current;
      if (!last) return;

      const sc = strokeCanvasRef.current;
      if (!sc) return;
      const sctx = sc.getContext("2d")!;

      // Draw line from last to current position (HTML prototype: line method)
      sctx.strokeStyle = selectedColor;
      sctx.lineWidth = brushSize;
      sctx.lineCap = "round";
      sctx.beginPath();
      sctx.moveTo(last.x, last.y);
      sctx.lineTo(x, y);
      sctx.stroke();

      brushLastPosRef.current = { x, y };
      mergeBrushStroke(baseState.naturalWidth, baseState.naturalHeight);
      triggerRedraw();
    },
    [mode, baseState, getCanvasCoords, selectedColor, brushSize, triggerRedraw]
  );

  const handleBrushMouseUp = useCallback(() => {
    if (!brushDrawingRef.current) return;
    brushDrawingRef.current = false;
    brushLastPosRef.current = null;

    // Commit stroke to undo history
    pushBakeSnapshot(bakeLayerRef.current);
    regionHistory.push([...regions]);
    setStatus(`ブラシ描画`);
  }, [pushBakeSnapshot, regionHistory, regions]);

  /**
   * Merges the current stroke offscreen canvas into bakeLayerRef.
   * Called on every tick during a brush stroke.
   */
  function mergeBrushStroke(w: number, h: number) {
    const sc = strokeCanvasRef.current;
    if (!sc || !bakeLayerRef.current) return;
    const sctx = sc.getContext("2d")!;
    const strokeData = sctx.getImageData(0, 0, w, h);
    const bakeData = bakeLayerRef.current.data;
    const sd = strokeData.data;
    for (let i = 0; i < w * h; i++) {
      const k = i * 4;
      const sa = sd[k + 3];
      if (sa === 0) continue;
      if (sa === 255) {
        bakeData[k] = sd[k];
        bakeData[k + 1] = sd[k + 1];
        bakeData[k + 2] = sd[k + 2];
        bakeData[k + 3] = 255;
      } else {
        const alpha = sa / 255;
        const inv = 1 - alpha;
        bakeData[k] = Math.round(bakeData[k] * inv + sd[k] * alpha);
        bakeData[k + 1] = Math.round(bakeData[k + 1] * inv + sd[k + 1] * alpha);
        bakeData[k + 2] = Math.round(bakeData[k + 2] * inv + sd[k + 2] * alpha);
        bakeData[k + 3] = Math.min(255, bakeData[k + 3] + sa);
      }
    }
    // Clear stroke canvas after merging so next tick only adds new pixels
    sctx.clearRect(0, 0, w, h);
  }

  // ---------------------------------------------------------------------------
  // Remove a specific region by id (mapping table undo)
  // ---------------------------------------------------------------------------

  const handleRemoveRegion = useCallback(
    (id: string) => {
      const next = regions.filter((r) => r.id !== id);
      pushBakeSnapshot(bakeLayerRef.current);
      regionHistory.push(next);
      setStatus("リージョンを削除しました");
    },
    [regions, regionHistory, pushBakeSnapshot]
  );

  // ---------------------------------------------------------------------------
  // B-1: Clipboard paste (Ctrl+V)
  // ---------------------------------------------------------------------------

  const handleClipboardPaste = useCallback(() => {
    if (!navigator.clipboard?.read) {
      setStatus("クリップボードAPIが利用できません");
      return;
    }
    navigator.clipboard.read().then((items) => {
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (!imageType) continue;
        item.getType(imageType).then((blob) => {
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            const offscreen = document.createElement("canvas");
            offscreen.width = w;
            offscreen.height = h;
            const ctx = offscreen.getContext("2d")!;
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, w, h);
            URL.revokeObjectURL(url);
            setBaseState({ imageData, naturalWidth: w, naturalHeight: h });
            regionHistory.reset([]);
            resetBakeHistory();
            setPalette(extractPaletteColors(imageData, 8));
            setStatus(`クリップボードから読み込み: ${w}x${h}`);
            // auto-fit on paste
            requestAnimationFrame(() => {
              const container = containerRef.current;
              if (container) zoom.fitToContainer(container.clientWidth, container.clientHeight, w, h);
            });
          };
          img.onerror = () => {
            setStatus("クリップボード画像の読み込みに失敗しました");
            URL.revokeObjectURL(url);
          };
          img.src = url;
        }).catch(() => setStatus("クリップボード読み込みエラー"));
        return;
      }
      setStatus("クリップボードに画像がありません");
    }).catch(() => setStatus("クリップボードへのアクセスが拒否されました"));
  }, [regionHistory, zoom, resetBakeHistory]);

  // ---------------------------------------------------------------------------
  // B-1: Transparent white
  // ---------------------------------------------------------------------------

  const handleTransparentWhite = useCallback(() => {
    if (!baseState.imageData) return;
    const { pixels } = makeWhiteTransparent(baseState.imageData, 5);
    if (pixels.length === 0) {
      setStatus("白ピクセルが見つかりませんでした");
      showToast("白ピクセルが見つかりませんでした", "error");
      return;
    }
    const newRegion: PaintRegion = {
      id: `region-${Date.now()}`,
      pixels,
      color: "#ffffff",
      transparent: true,
    };
    pushBakeSnapshot(bakeLayerRef.current);
    regionHistory.push([...regions, newRegion]);
    setStatus(`白を透過: ${pixels.length}px`);
    showToast(`白を透過しました (${pixels.length}px)`);
  }, [baseState.imageData, regions, regionHistory, pushBakeSnapshot, showToast]);

  // ---------------------------------------------------------------------------
  // B-2: Save brand swatch
  // ---------------------------------------------------------------------------

  const handleSaveBrandSwatch = useCallback(() => {
    setBrandSwatches((prev) => {
      if (prev.includes(selectedColor)) return prev;
      const next = [selectedColor, ...prev].slice(0, BRAND_SWATCHES_MAX);
      saveBrandSwatches(next);
      return next;
    });
    setStatus(`ブランドカラーに保存: ${selectedColor.toUpperCase()}`);
    showToast(`ブランドカラーに保存: ${selectedColor.toUpperCase()}`);
  }, [selectedColor, showToast]);

  const handleRemoveBrandSwatch = useCallback((hex: string) => {
    setBrandSwatches((prev) => {
      const next = prev.filter((c) => c !== hex);
      saveBrandSwatches(next);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Export handlers
  // ---------------------------------------------------------------------------

  const handleExportSvg = useCallback(() => {
    if (!baseState.imageData) return;
    const svgString = buildSvg(
      baseState.imageData,
      regions,
      baseState.naturalWidth,
      baseState.naturalHeight
    );
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.svg";
    a.click();
    URL.revokeObjectURL(url);
    setStatus("SVGをエクスポートしました");
    showToast("SVGをエクスポートしました");
  }, [baseState, regions, showToast]);

  const handleExportPng = useCallback(() => {
    if (!baseState.imageData) return;
    const composited = compositeRegions(baseState.imageData, regions, bakeLayerRef.current);
    const url = imageDataToPngDataUrl(composited, pngScale);
    const a = document.createElement("a");
    a.href = url;
    a.download = `export_${pngScale}x.png`;
    a.click();
    setStatus(`PNGをエクスポートしました (${pngScale}x)`);
    showToast(`PNGをエクスポートしました (${pngScale}x)`);
  }, [baseState, regions, pngScale, showToast]);

  // ---------------------------------------------------------------------------
  // Fit to container
  // ---------------------------------------------------------------------------

  const handleFit = useCallback(() => {
    const container = containerRef.current;
    if (!container || baseState.naturalWidth === 0) return;
    zoom.fitToContainer(
      container.clientWidth,
      container.clientHeight,
      baseState.naturalWidth,
      baseState.naturalHeight
    );
  }, [zoom, baseState.naturalWidth, baseState.naturalHeight]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const canvasCursor = spacePressed
    ? zoom.isPanning
      ? "grabbing"
      : "grab"
    : mode === "eyedropper"
      ? "cell"
      : mode === "replace-all"
        ? "crosshair"
        : mode === "brush"
          ? "crosshair"
          : mode === "color" || mode === "transparent"
            ? baseState.imageData ? "crosshair" : "default"
            : "default";

  const zoomPercent = Math.round(zoom.scale * 100);

  // Mapping entries: color regions only, most recent first
  const mappingEntries = regions.filter((r) => !r.transparent).slice().reverse();

  // Mode label (Japanese + English) for status bar
  const modeLabel =
    mode === "color" ? "色変更 / Color" :
    mode === "transparent" ? "透過 / Transparent" :
    mode === "eyedropper" ? "スポイト / Eyedropper" :
    mode === "brush" ? "ブラシ / Brush" :
    "一括置換 / Replace-All";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: T.color.bgBase,
        color: T.color.textPrimary,
        fontFamily: T.font.family,
      }}
    >
      {/* Toolbar row 1 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: T.space.sm,
          padding: `6px ${T.space.md}px`,
          background: T.color.bgPanel,
          borderBottom: `1px solid ${T.color.border}`,
          flexWrap: "wrap",
          position: "relative",
        }}
      >
        {/* Open image */}
        <Tooltip label="画像を開く">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={iconBtnStyle}
            aria-label="画像を開く"
          >
            <FolderOpen size={18} />
          </button>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />

        <div style={dividerStyle} />

        {/* Mode buttons (icon) */}
        <Tooltip label="色変更">
          <button
            type="button"
            aria-pressed={mode === "color" ? "true" : "false"}
            onClick={() => setMode("color")}
            style={mode === "color" ? iconBtnActiveStyle : iconBtnStyle}
            aria-label="色変更"
          >
            <PaintBucket size={18} />
          </button>
        </Tooltip>
        <Tooltip label="透過">
          <button
            type="button"
            aria-pressed={mode === "transparent" ? "true" : "false"}
            onClick={() => setMode("transparent")}
            style={mode === "transparent" ? iconBtnActiveStyle : iconBtnStyle}
            aria-label="透過"
          >
            <Eraser size={18} />
          </button>
        </Tooltip>
        <Tooltip label="スポイト" shortcut="I">
          <button
            type="button"
            aria-pressed={mode === "eyedropper" ? "true" : "false"}
            onClick={() => setMode("eyedropper")}
            style={mode === "eyedropper" ? iconBtnActiveStyle : iconBtnStyle}
            aria-label="スポイト"
          >
            <Pipette size={18} />
          </button>
        </Tooltip>
        <Tooltip label="同色一括" shortcut="R">
          <button
            type="button"
            aria-pressed={mode === "replace-all" ? "true" : "false"}
            onClick={() => setMode("replace-all")}
            style={mode === "replace-all" ? iconBtnActiveStyle : iconBtnStyle}
            aria-label="同色一括"
          >
            <Replace size={18} />
          </button>
        </Tooltip>
        <Tooltip label="ブラシ" shortcut="B">
          <button
            type="button"
            aria-pressed={mode === "brush" ? "true" : "false"}
            onClick={() => setMode("brush")}
            style={mode === "brush" ? iconBtnActiveStyle : iconBtnStyle}
            aria-label="ブラシ"
          >
            <Paintbrush size={18} />
          </button>
        </Tooltip>

        {/* Color swatch + existing input[type=color] + HSV picker toggle */}
        {(mode === "color" || mode === "replace-all" || mode === "brush") && (
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 2 }}>
            {/* Color swatch circle — click to toggle HSV picker */}
            <button
              ref={colorSwatchRef}
              type="button"
              onClick={() => setHsvPickerOpen((v) => !v)}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: selectedColor,
                border: `2px solid ${T.color.borderMid}`,
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
              }}
              title="HSVピッカーで色を選択"
              aria-label="HSVピッカーを開く"
            />
            {/* Existing native color input kept for accessibility / hex precision */}
            <input
              type="color"
              value={selectedColor}
              onChange={(e) => {
                setSelectedColor(e.target.value);
                setHsvPickerOpen(false);
              }}
              style={{
                width: 18,
                height: 18,
                cursor: "pointer",
                border: `1px solid ${T.color.borderMid}`,
                borderRadius: T.radius.sm,
                background: "none",
                padding: 0,
                outline: "none",
                opacity: 0.7,
              }}
              title="色を直接入力"
            />
            {/* HSV picker popup */}
            {hsvPickerOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 200 }}>
                <HsvPicker
                  hex={selectedColor}
                  onChange={(h) => setSelectedColor(h)}
                  onClose={() => setHsvPickerOpen(false)}
                />
              </div>
            )}
          </div>
        )}

        <div style={dividerStyle} />

        {/* Brush size — only shown in brush mode */}
        {mode === "brush" && (
          <>
            <span style={labelStyle}>太さ: {brushSize}</span>
            <input
              type="range"
              min={1}
              max={100}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              style={{ width: 80 }}
              title="ブラシサイズ (1-100px)"
            />
          </>
        )}

        {/* Tolerance — not shown in brush mode */}
        {mode !== "brush" && (
          <>
            <span style={labelStyle}>許容値: {tolerance}</span>
            <input
              type="range"
              min={0}
              max={128}
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
              style={{ width: 80 }}
              title="色許容値"
            />
          </>
        )}

        {/* S2: Hole-fill (closeMask) — shown when not in brush mode */}
        {mode !== "brush" && (
          <>
            <span style={labelStyle}>穴埋め: {closeRadius}</span>
            <input
              type="range"
              min={0}
              max={5}
              step={1}
              value={closeRadius}
              onChange={(e) => setCloseRadius(Number(e.target.value))}
              style={{ width: 60 }}
              title="穴埋め半径 (0=OFF, クロージング半径 1-5)"
            />
          </>
        )}

        {/* S3: Feather radius — shown when not in brush mode */}
        {mode !== "brush" && (
          <>
            <span style={labelStyle}>フェザー: {featherRadius}</span>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={featherRadius}
              onChange={(e) => setFeatherRadius(Number(e.target.value))}
              style={{ width: 70 }}
              title="フェザー (境界ぼかし) 0=OFF, 1-20px"
            />
          </>
        )}

        {/* Smooth replace checkbox — shown only in replace-all mode */}
        {mode === "replace-all" && (
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }} title="境界を滑らかにブレンドして置換">
            <input
              type="checkbox"
              checked={smoothReplace}
              onChange={(e) => setSmoothReplace(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            滑らかに置換
          </label>
        )}

        {/* B-2: antialias boundary inclusion — not shown in brush/replace-all mode */}
        {mode !== "brush" && mode !== "replace-all" && (
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }} title="色相が近い半透明ピクセルも境界として含める">
            <input
              type="checkbox"
              checked={includeAntialias}
              onChange={(e) => setIncludeAntialias(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            境界含める
          </label>
        )}

        {/* B-3: connectivity toggle — not shown in brush/replace-all mode */}
        {mode !== "brush" && mode !== "replace-all" && (
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }} title="斜め隣接ピクセルを同色選択に含める (8近傍)">
            <input
              type="checkbox"
              checked={connectivity === 8}
              onChange={(e) => setConnectivity(e.target.checked ? 8 : 4)}
              style={{ cursor: "pointer" }}
            />
            8近傍
          </label>
        )}
      </div>

      {/* Toolbar row 2 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: T.space.sm,
          padding: `6px ${T.space.md}px`,
          background: T.color.bgPanel,
          borderBottom: `1px solid ${T.color.border}`,
          flexWrap: "wrap",
        }}
      >
        {/* Undo / Redo / Reset */}
        <Tooltip label="元に戻す" shortcut="Ctrl+Z">
          <button
            type="button"
            onClick={() => { regionHistory.undo(); undoBakeSnapshot(); triggerRedraw(); setStatus("元に戻しました"); }}
            disabled={!regionHistory.canUndo}
            style={!regionHistory.canUndo ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
            aria-label="元に戻す"
          >
            <Undo2 size={18} />
          </button>
        </Tooltip>
        <Tooltip label="やり直し" shortcut="Ctrl+Y">
          <button
            type="button"
            onClick={() => { regionHistory.redo(); redoBakeSnapshot(); triggerRedraw(); setStatus("やり直しました"); }}
            disabled={!regionHistory.canRedo}
            style={!regionHistory.canRedo ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
            aria-label="やり直し"
          >
            <Redo2 size={18} />
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={() => { regionHistory.reset([]); resetBakeHistory(); triggerRedraw(); setStatus("全リセット完了"); }}
          disabled={regions.length === 0}
          style={regions.length === 0 ? { ...btnDangerStyle, opacity: 0.35, pointerEvents: "none" } : btnDangerStyle}
        >
          全リセット
        </button>

        <div style={dividerStyle} />

        {/* Zoom fit */}
        <Tooltip label="フィット表示" shortcut="Ctrl+0">
          <button
            type="button"
            onClick={handleFit}
            disabled={!baseState.imageData}
            style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
            aria-label="フィット表示"
          >
            <Maximize2 size={18} />
          </button>
        </Tooltip>

        <div style={dividerStyle} />

        {/* Export SVG */}
        <Tooltip label="SVG出力">
          <button
            type="button"
            onClick={handleExportSvg}
            disabled={!baseState.imageData}
            style={!baseState.imageData ? { ...iconBtnSuccessStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnSuccessStyle}
            aria-label="SVG出力"
          >
            <FileCode2 size={18} />
          </button>
        </Tooltip>

        {/* Export PNG with scale selector */}
        <Tooltip label="PNG出力">
          <button
            type="button"
            onClick={handleExportPng}
            disabled={!baseState.imageData}
            style={!baseState.imageData ? { ...iconBtnSuccessStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnSuccessStyle}
            aria-label="PNG出力"
          >
            <Download size={18} />
          </button>
        </Tooltip>
        <select
          value={pngScale}
          onChange={(e) => setPngScale(Number(e.target.value) as 1 | 2 | 4)}
          style={selectStyle}
          title="PNG出力倍率"
        >
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
        </select>

        <div style={dividerStyle} />

        {/* B-1: Transparent white */}
        <Tooltip label="白を透過">
          <button
            type="button"
            onClick={handleTransparentWhite}
            disabled={!baseState.imageData}
            style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
            aria-label="白を透過"
          >
            <Wand2 size={18} />
          </button>
        </Tooltip>

        {/* B-2: Save brand swatch */}
        {(mode === "color" || mode === "replace-all") && (
          <button
            type="button"
            onClick={handleSaveBrandSwatch}
            style={btnStyle}
            title="現在の選択色をブランドカラーとして保存 (最大8色)"
          >
            色を保存
          </button>
        )}

        {/* B-3: Before/after comparison */}
        <button
          type="button"
          onMouseDown={() => setComparing(true)}
          onMouseUp={() => setComparing(false)}
          onMouseLeave={() => setComparing(false)}
          disabled={!baseState.imageData || regions.length === 0}
          style={
            (!baseState.imageData || regions.length === 0)
              ? { ...btnStyle, opacity: 0.35, pointerEvents: "none" }
              : comparing
                ? { ...btnStyle, background: T.color.bgElevated, border: `1px solid ${T.color.accent}` }
                : btnStyle
          }
          title="押している間は編集前の元画像を表示"
        >
          比較
        </button>

        <div style={dividerStyle} />

        {/* Panel toggles */}
        <button
          type="button"
          onClick={() => setShowPalette((v) => !v)}
          style={showPalette ? { ...btnStyle, border: `1px solid ${T.color.accent}` } : btnSubtleStyle}
        >
          {showPalette ? "パレット ▲" : "パレット ▼"}
        </button>
        <button
          type="button"
          onClick={() => setShowMapping((v) => !v)}
          style={showMapping ? { ...btnStyle, border: `1px solid ${T.color.accent}` } : btnSubtleStyle}
        >
          {showMapping ? "編集ログ ▲" : "編集ログ ▼"}
        </button>
      </div>

      {/* Palette panel */}
      {showPalette && palette.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: T.space.xs + 2,
            padding: `6px ${T.space.md}px`,
            background: T.color.bgPanel,
            borderBottom: `1px solid ${T.color.border}`,
          }}
        >
          <span style={{ ...labelStyle, marginRight: T.space.xs }}>主要色:</span>
          {palette.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => {
                setSelectedColor(hex);
                if (mode !== "color" && mode !== "replace-all") setMode("color");
              }}
              title={hex.toUpperCase()}
              style={{
                width: 22,
                height: 22,
                background: hex,
                border: selectedColor === hex
                  ? `2px solid ${T.color.accent}`
                  : `1px solid ${T.color.borderMid}`,
                borderRadius: T.radius.sm,
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      )}

      {/* S3: Recent colors panel */}
      {recentColors.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: T.space.xs + 2,
            padding: `4px ${T.space.md}px`,
            background: T.color.bgBase,
            borderBottom: `1px solid ${T.color.border}`,
            flexWrap: "wrap",
          }}
        >
          <span style={{ ...labelStyle, marginRight: T.space.xs }}>最近:</span>
          {recentColors.map((hex, i) => (
            <button
              key={`${hex}-${i}`}
              type="button"
              onClick={() => {
                setSelectedColor(hex);
                if (mode !== "color" && mode !== "replace-all") setMode("color");
              }}
              title={hex.toUpperCase()}
              style={{
                width: 22,
                height: 22,
                background: hex,
                border: selectedColor === hex
                  ? `2px solid ${T.color.accent}`
                  : `1px solid ${T.color.borderMid}`,
                borderRadius: T.radius.sm,
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
                transition: "transform 80ms",
              }}
            />
          ))}
        </div>
      )}

      {/* B-2: Brand color swatches panel */}
      {brandSwatches.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: T.space.xs + 2,
            padding: `4px ${T.space.md}px`,
            background: T.color.bgBase,
            borderBottom: `1px solid ${T.color.border}`,
            flexWrap: "wrap",
          }}
        >
          <span style={{ ...labelStyle, marginRight: T.space.xs }}>ブランド:</span>
          {brandSwatches.map((hex) => (
            <div key={hex} style={{ position: "relative", display: "inline-flex" }}>
              <button
                type="button"
                onClick={() => {
                  setSelectedColor(hex);
                  if (mode !== "color" && mode !== "replace-all") setMode("color");
                }}
                title={hex.toUpperCase()}
                style={{
                  width: 22,
                  height: 22,
                  background: hex,
                  border: selectedColor === hex
                    ? `2px solid ${T.color.accent}`
                    : `1px solid ${T.color.borderMid}`,
                  borderRadius: T.radius.sm,
                  cursor: "pointer",
                  padding: 0,
                  flexShrink: 0,
                }}
              />
              <button
                type="button"
                onClick={() => handleRemoveBrandSwatch(hex)}
                title={`${hex.toUpperCase()} を削除`}
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  width: 12,
                  height: 12,
                  background: T.color.swatchRemoveBg,
                  color: T.color.textPrimary,
                  border: "none",
                  borderRadius: "50%",
                  cursor: "pointer",
                  fontSize: 8,
                  lineHeight: "12px",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main area: canvas + right sidebar */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Canvas area */}
        <div
          ref={containerRef}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onContextMenu={(e) => {
            e.preventDefault();
            setShortcutPos({ x: e.clientX, y: e.clientY });
          }}
          onWheel={zoom.onWheel}
          onMouseDown={zoom.onMouseDown}
          onMouseMove={zoom.onMouseMove}
          onMouseUp={zoom.onMouseUp}
          onMouseLeave={zoom.onMouseUp}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            position: "relative",
            cursor: canvasCursor,
            backgroundImage:
              `linear-gradient(45deg, ${T.color.checkerA} 25%, transparent 25%), ` +
              `linear-gradient(-45deg, ${T.color.checkerA} 25%, transparent 25%), ` +
              `linear-gradient(45deg, transparent 75%, ${T.color.checkerA} 75%), ` +
              `linear-gradient(-45deg, transparent 75%, ${T.color.checkerA} 75%)`,
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
            backgroundColor: T.color.checkerB,
          }}
        >
          {!baseState.imageData ? (
            <div style={dropZoneStyle}>
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={dropZoneIconStyle}
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <div>
                <p style={dropZoneTitleStyle}>
                  画像をドロップ
                </p>
                <p style={dropZoneSubStyle}>
                  PNG / JPG / SVG / WebP
                </p>
              </div>
              <div style={dropZoneDividerStyle}>
                <span style={dropZoneDividerLineStyle} />
                または
                <span style={dropZoneDividerLineStyle} />
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={dropZoneButtonStyle}
              >
                ファイルを選択
              </button>
            </div>
          ) : (
            <div
              style={{
                transform: `translate(${zoom.offsetX}px, ${zoom.offsetY}px) scale(${zoom.scale})`,
                transformOrigin: "0 0",
                position: "absolute",
                top: 0,
                left: 0,
              }}
            >
              <canvas
                ref={canvasRef}
                width={baseState.naturalWidth}
                height={baseState.naturalHeight}
                onClick={handleCanvasClick}
                onMouseDown={handleBrushMouseDown}
                onMouseMove={(e) => { handleCanvasMouseMove(e); handleBrushMouseMove(e); }}
                onMouseUp={handleBrushMouseUp}
                onMouseLeave={() => { handleCanvasMouseLeave(); handleBrushMouseUp(); }}
                style={{ cursor: canvasCursor, display: "block" } as React.CSSProperties}
              />
            </div>
          )}

          {/* Status bar (bottom-left): hover coordinates (primary) or operation status */}
          {baseState.imageData && (hoverInfo || status) && (
            <div style={statusBarStyle}>
              <span style={statusModeLabelStyle}>[{modeLabel}]</span>
              {hoverInfo ?? status}
            </div>
          )}

          {/* Zoom indicator (bottom-right) */}
          {baseState.imageData && (
            <div style={zoomIndicatorStyle}>
              {zoomPercent}%
            </div>
          )}
        </div>

        {/* Mapping sidebar */}
        {showMapping && mappingEntries.length > 0 && (
          <div style={sidebarStyle}>
            <div style={sidebarHeaderStyle}>
              編集ログ ({mappingEntries.length})
            </div>
            <div style={sidebarScrollStyle}>
              {mappingEntries.map((region) => (
                <div key={region.id} style={sidebarRowStyle}>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      background: region.color,
                      border: `1px solid ${T.color.borderMid}`,
                      borderRadius: T.radius.sm,
                      flexShrink: 0,
                      display: "inline-block",
                    }}
                  />
                  <span style={sidebarColorLabelStyle}>
                    {region.color.toUpperCase()}
                    <br />
                    <span style={sidebarPixelCountStyle}>{region.pixels.length}px</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRegion(region.id)}
                    style={sidebarRemoveBtnStyle}
                    title="このリージョンを削除"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* S3: Toast notification */}
      <Toast
        toast={currentToast}
        onDismiss={() => setCurrentToast(null)}
      />

      {/* S3: Shortcut help popover */}
      {shortcutPos && (
        <ShortcutHelp
          x={shortcutPos.x}
          y={shortcutPos.y}
          onClose={() => setShortcutPos(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const btnStyle: React.CSSProperties = {
  padding: "3px 10px",
  background: T.color.bgElevated,
  color: T.color.textPrimary,
  border: `1px solid ${T.color.borderMid}`,
  borderRadius: T.radius.sm,
  cursor: "pointer",
  fontSize: T.font.label,
  fontFamily: T.font.family,
  transition: "background 120ms",
};

const btnDangerStyle: React.CSSProperties = {
  ...btnStyle,
  background: T.color.danger,
  border: `1px solid ${T.color.danger}`,
};

const btnSubtleStyle: React.CSSProperties = {
  ...btnStyle,
  background: "transparent",
  border: `1px solid ${T.color.borderMid}`,
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 22,
  background: T.color.border,
  flexShrink: 0,
};

const labelStyle: React.CSSProperties = {
  fontSize: T.font.label,
  color: T.color.textMuted,
  fontFamily: T.font.family,
};

const statusBarStyle: React.CSSProperties = {
  position: "absolute",
  bottom: T.space.sm,
  left: T.space.md,
  fontSize: T.font.label,
  color: T.color.textPrimary,
  background: T.color.overlay,
  padding: "2px 8px",
  borderRadius: T.radius.sm,
  pointerEvents: "none",
  maxWidth: "60%",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  fontFamily: T.font.family,
};

const zoomIndicatorStyle: React.CSSProperties = {
  position: "absolute",
  bottom: T.space.sm,
  right: T.space.md,
  fontSize: T.font.label,
  color: T.color.textMuted,
  background: T.color.overlayMid,
  padding: "2px 6px",
  borderRadius: T.radius.sm,
  pointerEvents: "none",
  fontFamily: T.font.family,
};

const statusModeLabelStyle: React.CSSProperties = {
  color: T.color.textMuted,
  marginRight: T.space.xs + 2,
};

// Drop zone (empty state)
const dropZoneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: T.space.md,
  border: `2px dashed ${T.color.borderMid}`,
  borderRadius: T.radius.lg,
  padding: `${T.space.xl * 2}px ${T.space.xl * 3}px`,
  textAlign: "center",
  color: T.color.textMuted,
  pointerEvents: "none",
  background: "rgba(255,255,255,0.02)",
};

const dropZoneIconStyle: React.CSSProperties = {
  color: T.color.textMuted,
  flexShrink: 0,
};

const dropZoneTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: T.font.body,
  color: T.color.textPrimary,
  fontFamily: T.font.family,
};

const dropZoneSubStyle: React.CSSProperties = {
  margin: `${T.space.xs}px 0 0`,
  fontSize: T.font.label,
  color: T.color.textMuted,
  fontFamily: T.font.family,
};

const dropZoneDividerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: T.space.sm,
  color: T.color.textDim,
  fontSize: T.font.label,
  fontFamily: T.font.family,
};

const dropZoneDividerLineStyle: React.CSSProperties = {
  width: 40,
  height: 1,
  background: T.color.border,
  display: "inline-block",
};

const dropZoneButtonStyle: React.CSSProperties = {
  ...btnSubtleStyle,
  pointerEvents: "auto",
  fontSize: T.font.label,
  padding: "5px 16px",
  borderRadius: T.radius.md,
};

// Mapping sidebar
const sidebarStyle: React.CSSProperties = {
  width: 220,
  background: T.color.bgPanel,
  borderLeft: `1px solid ${T.color.border}`,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const sidebarHeaderStyle: React.CSSProperties = {
  padding: `${T.space.xs + 2}px ${T.space.sm + 2}px`,
  borderBottom: `1px solid ${T.color.border}`,
  fontSize: T.font.label,
  color: T.color.textMuted,
  fontWeight: "bold",
  fontFamily: T.font.family,
};

const sidebarScrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
};

const sidebarRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: T.space.xs + 2,
  padding: `${T.space.xs}px ${T.space.sm}px`,
  borderBottom: `1px solid ${T.color.border}`,
  fontSize: T.font.label,
};

const sidebarColorLabelStyle: React.CSSProperties = {
  color: T.color.textPrimary,
  flex: 1,
  fontFamily: "monospace",
  fontSize: T.font.badge,
};

const sidebarPixelCountStyle: React.CSSProperties = {
  color: T.color.textDim,
};

const sidebarRemoveBtnStyle: React.CSSProperties = {
  background: T.color.dangerDark,
  color: T.color.danger,
  border: "none",
  borderRadius: T.radius.sm,
  cursor: "pointer",
  fontSize: T.font.badge,
  padding: "1px 5px",
  flexShrink: 0,
  fontFamily: T.font.family,
};

// Icon button styles (S2: lucide-react icon buttons)
const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  padding: 0,
  background: T.color.bgElevated,
  color: T.color.textPrimary,
  border: `1px solid ${T.color.borderMid}`,
  borderRadius: T.radius.sm,
  cursor: "pointer",
  // S3: transition補完
  transition: "background 120ms, transform 80ms",
  flexShrink: 0,
};

const iconBtnActiveStyle: React.CSSProperties = {
  ...iconBtnStyle,
  background: T.color.accent,
  border: `1px solid ${T.color.accent}`,
  boxShadow: "inset 0 1px 3px rgba(0,0,0,0.35)",
};

const iconBtnSuccessStyle: React.CSSProperties = {
  ...iconBtnStyle,
  background: T.color.success,
  border: `1px solid ${T.color.success}`,
};

const selectStyle: React.CSSProperties = {
  background: T.color.bgElevated,
  color: T.color.textPrimary,
  border: `1px solid ${T.color.borderMid}`,
  borderRadius: T.radius.sm,
  fontSize: T.font.label,
  fontFamily: T.font.family,
  padding: "3px 4px",
  cursor: "pointer",
};
