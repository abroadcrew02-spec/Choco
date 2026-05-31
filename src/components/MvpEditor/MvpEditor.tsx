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
  Copy,
  Wand2,
  Type,
  Square,
  Droplets,
  Layers,
  Grid3x3,
  Magnet,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignCenter,
  Save,
  FolderInput,
  Clock,
  Frame,
  HelpCircle,
} from "lucide-react";
import {
  serializeProject,
  deserializeProject,
  downloadChocoFile,
  openChocoFile,
} from "./lib/projectIO";
import {
  addRecentFile,
  getRecentFiles,
  makeThumbnail,
  formatRelativeTime,
  type RecentFileEntry,
} from "./lib/recentFiles";
import { useAutoSave } from "./hooks/useAutoSave";
import {
  cropImageData,
  scaleImageData,
  cropRegion,
  scaleRegion,
} from "./lib/canvasResize";
import { CanvasSizeModal } from "./components/CanvasSizeModal";
import type { AnchorPosition, ResizeMode } from "./lib/canvasResize";
import {
  GradientEditor,
  type FillType,
  type GradientConfig,
  DEFAULT_GRADIENT_CONFIG,
  applyLinearGradient,
  applyRadialGradient,
} from "./components/GradientEditor";
import { useEditorHistory } from "./hooks/useEditorHistory";
import { useZoomPan } from "./hooks/useZoomPan";
import { HsvPicker } from "./components/HsvPicker";
import { Tooltip } from "./components/Tooltip";
import { Toast, type ToastMessage } from "./components/Toast";
import { ShortcutHelp } from "./components/ShortcutHelp";
import {
  ExportModal,
  getMimeType,
  getFileExtension,
  calcOutputSize,
  type ExportOptions,
} from "./components/ExportModal";

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

type EditorMode = "color" | "transparent" | "eyedropper" | "replace-all" | "brush" | "text" | "shape";

type ShapeKind = "rect" | "circle" | "polygon" | "star";

interface TextDraft {
  x: number;
  y: number;
  value: string;
}

interface ShapeDraft {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  active: boolean;
}

// Palette sets stored in LocalStorage
const PALETTE_SETS_KEY = "choco_palette_sets";
const PALETTE_SETS_MAX = 10;

interface PaletteSet {
  id: string;
  name: string;
  colors: string[];
}

function loadPaletteSets(): PaletteSet[] {
  try {
    const raw = localStorage.getItem(PALETTE_SETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

function savePaletteSets(sets: PaletteSet[]): void {
  try {
    localStorage.setItem(PALETTE_SETS_KEY, JSON.stringify(sets));
  } catch {
    // ignore quota errors
  }
}

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
const SVG_TARGET_LONG_EDGE = 4096;
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
  r1: number, g1: number, b1: number, a1: number,
  r2: number, g2: number, b2: number, a2: number
): number {
  // Transparent pixels are treated as a distinct color class:
  // alpha=0 vs alpha>0 never match regardless of RGB values.
  if ((a1 === 0) !== (a2 === 0)) return Infinity;
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
  const startA = data[startIdx + 3];

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

    const dist = colorDistance(r, g, b, a, startR, startG, startB, startA);

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
  const startA = data[startIdx + 3];

  const result: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      if (colorDistance(r, g, b, a, startR, startG, startB, startA) <= tolerance) {
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
  const a0 = data[startIdx + 3];
  const [fr, fg, fb] = newColor;

  const resultData = new Uint8ClampedArray(data);
  const t2 = tolerance * tolerance * 4;
  const denom = tolerance * 2;

  for (let i = 0; i < width * height; i++) {
    const k = i * 4;
    // Skip pixels in a different alpha class (transparent vs opaque)
    if ((resultData[k + 3] === 0) !== (a0 === 0)) continue;
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
 * Renders ImageData to an offscreen canvas at the given output dimensions,
 * then triggers a Blob export via URL.createObjectURL.
 *
 * @param imageData  - Source image
 * @param outWidth   - Output canvas width in pixels
 * @param outHeight  - Output canvas height in pixels
 * @param mimeType   - MIME type for toBlob (e.g. "image/png")
 * @param quality    - Encoder quality 0–1 (used for jpeg/webp; ignored for png)
 * @param filename   - Download filename
 */
export function exportImageData(
  imageData: ImageData,
  outWidth: number,
  outHeight: number,
  mimeType: string,
  quality: number,
  filename: string
): void {
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d")!;
  if (outWidth !== imageData.width || outHeight !== imageData.height) {
    ctx.imageSmoothingEnabled = false;
    const tmp = document.createElement("canvas");
    tmp.width = imageData.width;
    tmp.height = imageData.height;
    const tmpCtx = tmp.getContext("2d")!;
    tmpCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(tmp, 0, 0, outWidth, outHeight);
  } else {
    ctx.putImageData(imageData, 0, 0);
  }
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    mimeType,
    quality / 100
  );
}

/**
 * Converts ImageData to a PNG data URL via an offscreen canvas.
 * Kept for internal/legacy use; prefer exportImageData for actual downloads.
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

/**
 * Removes collinear (same-direction) intermediate points from a polygon.
 * Consecutive points that lie on the same horizontal or vertical line are
 * collapsed to their endpoints, eliminating redundant vertices produced by
 * the axis-aligned marching squares trace.
 */
export function removeCollinear(
  points: { x: number; y: number }[]
): { x: number; y: number }[] {
  if (points.length <= 2) return points;
  const result: { x: number; y: number }[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    // Keep the point only if it is NOT collinear with its neighbours.
    // Two vectors are collinear when their cross product is zero.
    const crossZ = (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x);
    if (crossZ !== 0) result.push(curr);
  }
  result.push(points[points.length - 1]);
  return result;
}

/**
 * Douglas-Peucker polyline simplification.
 * Reduces vertex count while preserving the overall shape to within epsilon
 * pixels of perpendicular distance.
 */
export function simplifyPath(
  points: { x: number; y: number }[],
  epsilon: number
): { x: number; y: number }[] {
  if (points.length <= 2) return points;

  // Find the point with the maximum perpendicular distance from the line
  // connecting the first and last points.
  let maxDist = 0;
  let maxIdx = 0;
  const start = points[0];
  const end = points[points.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lineLen = Math.hypot(dx, dy);

  for (let i = 1; i < points.length - 1; i++) {
    let dist: number;
    if (lineLen === 0) {
      dist = Math.hypot(points[i].x - start.x, points[i].y - start.y);
    } else {
      // Perpendicular distance = |cross product| / line length
      const cross = Math.abs(dx * (start.y - points[i].y) - (start.x - points[i].x) * dy);
      dist = cross / lineLen;
    }
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPath(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPath(points.slice(maxIdx), epsilon);
    // Concatenate, removing the duplicate point at the junction.
    return left.slice(0, -1).concat(right);
  }
  return [start, end];
}

/** Maximum pixel count before falling back to a bounding-box rectangle path. */
const MARCHING_SQUARES_PIXEL_LIMIT = 2_000_000;

export function marchingSquaresPath(
  pixels: { x: number; y: number }[],
  onFallback?: () => void
): string {
  if (pixels.length === 0) return "";

  // Guard: large regions fall back to bounding-box rect to avoid OOM / runaway loops.
  if (pixels.length > MARCHING_SQUARES_PIXEL_LIMIT) {
    onFallback?.();
    let minX = pixels[0].x, maxX = pixels[0].x;
    let minY = pixels[0].y, maxY = pixels[0].y;
    for (const { x, y } of pixels) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return `M${minX} ${minY} L${maxX + 1} ${minY} L${maxX + 1} ${maxY + 1} L${minX} ${maxY + 1} Z`;
  }

  // Build a fast numeric lookup: key = y * rowStride + x.
  // Compute bounding box to determine stride (maxX + 2 to accommodate corner coords).
  let minX = pixels[0].x, maxX = pixels[0].x;
  let minY = pixels[0].y, maxY = pixels[0].y;
  for (const { x, y } of pixels) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const stride = maxX - minX + 2; // +2 so (x+1) is always in range

  const pixelSet = new Set<number>(
    pixels.map((p) => (p.y - minY) * stride + (p.x - minX))
  );

  function has(x: number, y: number): boolean {
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    return pixelSet.has((y - minY) * stride + (x - minX));
  }

  // Marching squares: collect all horizontal and vertical edge segments.
  // An edge exists where the inside/outside status changes between adjacent cells.
  // We collect axis-aligned unit edges, then chain them into closed loops.

  // Horizontal edges: top edge of pixel (x,y) if (x,y) is inside and (x,y-1) is outside,
  //                   bottom edge of pixel (x,y) if (x,y) is inside and (x,y+1) is outside.
  // Vertical edges:   left edge of pixel (x,y) if (x,y) is inside and (x-1,y) is outside,
  //                   right edge of pixel (x,y) if (x,y) is inside and (x+1,y) is outside.

  // Edge representation: each edge is from corner A to corner B (integer grid coords).
  // Corner (cx, cy) is encoded as a number using a separate corner stride so that
  // the key space is distinct from the pixel set.
  // Corner coords range from (minX, minY) to (maxX+1, maxY+1).

  interface Point { x: number; y: number }

  // Corner stride: corners span [minX .. maxX+1] x [minY .. maxY+1]
  const cStride = maxX - minX + 3; // corner x range = maxX+1-minX+1 = maxX-minX+2; +1 for safety

  function cornerKey(cx: number, cy: number): number {
    return (cy - minY) * cStride + (cx - minX);
  }

  type EdgeMap = Map<number, Point[]>;
  const edgeMap: EdgeMap = new Map();

  function addEdge(ax: number, ay: number, bx: number, by: number): void {
    const key = cornerKey(ax, ay);
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

  // Trace closed loops from the edge map.
  // Fix(#3): capture edgeMap.size BEFORE the loop so deletions do not shrink the
  // upper bound mid-traversal, preventing premature loop termination on large regions.
  const pathParts: string[] = [];
  const visitedCornerKeys = new Set<number>();

  for (const [startKey, _] of edgeMap) {
    if (visitedCornerKeys.has(startKey)) continue;

    // Decode corner key back to (x, y)
    const relY = Math.floor(startKey / cStride);
    const relX = startKey - relY * cStride;
    const firstPt: Point = { x: relX + minX, y: relY + minY };

    const loopPoints: Point[] = [firstPt];
    let current = firstPt;
    let loopClosed = false;

    // Use the initial edgeMap size (before any deletions) as the loop budget.
    const initialEdgeCount = edgeMap.size;

    for (let step = 0; step < initialEdgeCount + 4; step++) {
      const key = cornerKey(current.x, current.y);
      const nexts = edgeMap.get(key);
      if (!nexts || nexts.length === 0) break;

      const next = nexts[0];

      // Remove the used edge
      nexts.splice(0, 1);
      if (nexts.length === 0) edgeMap.delete(key);

      visitedCornerKeys.add(key);

      if (next.x === firstPt.x && next.y === firstPt.y) {
        loopClosed = true;
        break;
      }

      loopPoints.push(next);
      current = next;
    }

    if (loopPoints.length >= 2) {
      // Smooth the polygon: remove collinear vertices first, then
      // apply Douglas-Peucker to reduce staircase artifacts.
      const smoothed = simplifyPath(removeCollinear(loopPoints), 0.5);
      const d = smoothed
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
  height: number,
  onFallback?: () => void
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
      const d = marchingSquaresPath(region.pixels, onFallback);
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
      const a = data[idx + 3];
      if (colorDistance(r, g, b, a, 255, 255, 255, 255) <= tolerance) {
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
 * Returns the bounding box corners (normalized so x0<=x1, y0<=y1) from
 * two drag points.
 */
export function normalizeBbox(
  x0: number, y0: number, x1: number, y1: number
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  return { x, y, w, h };
}

/**
 * Draws a shape (rect/circle/polygon/star) onto a 2D canvas context.
 * Applies fill and/or stroke depending on fill/stroke settings.
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  kind: ShapeKind,
  x: number,
  y: number,
  w: number,
  h: number,
  fillColor: string | null,
  strokeColor: string | null,
  strokeWidth: number,
  polyVertices: number
): void {
  if (w <= 0 || h <= 0) return;

  ctx.save();
  ctx.beginPath();

  if (kind === "rect") {
    ctx.rect(x, y, w, h);
  } else if (kind === "circle") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2;
    const ry = h / 2;
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  } else if (kind === "polygon") {
    const n = Math.max(3, Math.min(12, polyVertices));
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2;
    const ry = h / 2;
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const px = cx + rx * Math.cos(angle);
      const py = cy + ry * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (kind === "star") {
    const n = 5;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const outerRx = w / 2;
    const outerRy = h / 2;
    const innerRx = outerRx * 0.4;
    const innerRy = outerRy * 0.4;
    for (let i = 0; i < n * 2; i++) {
      const angle = (Math.PI * i) / n - Math.PI / 2;
      const rx2 = i % 2 === 0 ? outerRx : innerRx;
      const ry2 = i % 2 === 0 ? outerRy : innerRy;
      const px = cx + rx2 * Math.cos(angle);
      const py = cy + ry2 * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  if (strokeColor && strokeWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
  ctx.restore();
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

/**
 * Returns true when a keyboard event's target is an editable element
 * (input, textarea, or contenteditable). Used to suppress bare tool
 * shortcuts while the user is typing.
 */
export function isInputFocused(target: EventTarget | null): boolean {
  if (target == null) return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable === true;
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

  const editorHistory = useEditorHistory();
  const regions = editorHistory.regions;
  const bakeLayerRef = editorHistory.bakeLayerRef;

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
  const [exportModalOpen, setExportModalOpen] = useState(false);
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

  // S5-2: palette sets
  const [paletteSets, setPaletteSets] = useState<PaletteSet[]>(loadPaletteSets);
  const [activePaletteSetId, setActivePaletteSetId] = useState<string | null>(null);

  // S5-1: text tool draft
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [textFontFamily, setTextFontFamily] = useState<string>("sans-serif");
  const [textFontSize, setTextFontSize] = useState<number>(48);
  const textInputRef = useRef<HTMLInputElement>(null);

  // S6-1: shape tool state
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect");
  const [polyVertices, setPolyVertices] = useState<number>(6);
  const shapeDraftRef = useRef<ShapeDraft | null>(null);
  const shapeOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // S6-2: stroke/fill state
  const [strokeColor, setStrokeColor] = useState<string>("#000000");
  const [strokeWidth, setStrokeWidth] = useState<number>(2);
  const [useFill, setUseFill] = useState<boolean>(true);
  const [useStroke, setUseStroke] = useState<boolean>(true);

  // S7: opacity (0-100, default 100)
  const [opacity, setOpacity] = useState<number>(100);

  // S7: blend mode
  type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
  const [blendMode, setBlendMode] = useState<BlendMode>("normal");

  // S7: fill type + gradient config
  const [fillType, setFillType] = useState<FillType>("solid");
  const [gradientConfig, setGradientConfig] = useState<GradientConfig>(DEFAULT_GRADIENT_CONFIG);
  const [gradientEditorOpen, setGradientEditorOpen] = useState<boolean>(false);

  // Issue #5: autosave restore modal
  const [showRestoreModal, setShowRestoreModal] = useState<boolean>(false);

  // Issue #7: recent files dropdown
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>(() => getRecentFiles());
  const [recentMenuOpen, setRecentMenuOpen] = useState<boolean>(false);
  const recentMenuRef = useRef<HTMLDivElement>(null);

  // S8: grid / snap
  const [gridEnabled, setGridEnabled] = useState<boolean>(false);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(false);
  const [gridSize, setGridSize] = useState<number>(20);

  // S8: draft transform (rotate + flip) — applied on shape/text commit
  const [draftRotateDeg, setDraftRotateDeg] = useState<number>(0);
  const [draftFlipX, setDraftFlipX] = useState<boolean>(false);
  const [draftFlipY, setDraftFlipY] = useState<boolean>(false);

  // Issue #9: canvas size modal
  const [canvasSizeModalOpen, setCanvasSizeModalOpen] = useState<boolean>(false);

  const zoom = useZoomPan(spacePressed);

  // ---------------------------------------------------------------------------
  // Issue #5: AutoSave
  // ---------------------------------------------------------------------------

  const getAutoSaveState = useCallback(() => {
    if (!baseState.imageData) return null;
    return {
      imageData: baseState.imageData,
      naturalWidth: baseState.naturalWidth,
      naturalHeight: baseState.naturalHeight,
      regions,
      bakeLayer: bakeLayerRef.current,
      selectedColor,
      tolerance,
    };
  }, [baseState, regions, selectedColor, tolerance]);

  const autoSave = useAutoSave(getAutoSaveState, !!baseState.imageData, {
    onSave: () => setStatus("自動保存しました"),
    onError: () => {
      setStatus("自動保存できませんでした（容量超過）");
      toastIdRef.current += 1;
      setCurrentToast({
        message: "オートセーブできませんでした（容量超過）",
        type: "error",
        id: toastIdRef.current,
      });
    },
  });

  // On mount: check for autosave and show restore modal if found
  useEffect(() => {
    if (autoSave.hasAutoSave()) {
      setShowRestoreModal(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Issue #7: close recent-files dropdown on outside click
  useEffect(() => {
    if (!recentMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        recentMenuRef.current &&
        !recentMenuRef.current.contains(e.target as Node)
      ) {
        setRecentMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [recentMenuOpen]);

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
  // S5-1: Auto-focus text input when textDraft is set
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (textDraft !== null) {
      // Use rAF to ensure the input has rendered before focusing
      requestAnimationFrame(() => {
        textInputRef.current?.focus();
      });
    }
  }, [textDraft]);


  // ---------------------------------------------------------------------------
  // Keyboard shortcuts: Ctrl+Z, Ctrl+Y, Ctrl+0, Space, I, R, B
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore bare tool shortcuts when an input element has focus.
      // Modifier-based shortcuts (Ctrl/Meta) are always processed.
      if (!e.ctrlKey && !e.metaKey && isInputFocused(e.target)) return;

      if (e.code === "Space") {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        editorHistory.undo();
        triggerRedraw();
        setStatus("元に戻しました");
        return;
      }
      if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
        e.preventDefault();
        editorHistory.redo();
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
      // Ctrl+C: copy composited canvas to clipboard as PNG (Issue #8)
      // Only fires when no input element is focused (text copy is handled by browser default).
      if (e.ctrlKey && e.key === "c" && !isInputFocused(e.target)) {
        e.preventDefault();
        handleCopyToClipboard();
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
      // T = text tool
      if (!e.ctrlKey && !e.altKey && e.key === "t") {
        setMode("text");
        return;
      }
      // U = shape tool
      if (!e.ctrlKey && !e.altKey && e.key === "u") {
        setMode("shape");
        return;
      }
      // Escape: cancel text draft
      if (e.key === "Escape") {
        setTextDraft(null);
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
  }, [editorHistory, baseState.naturalWidth, baseState.naturalHeight, zoom, triggerRedraw]);

  // ---------------------------------------------------------------------------
  // Canvas redraw
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !baseState.imageData) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (comparing) {
      // B-3: before/after comparison — show base + bakeLayer without regions applied
      const preRegions = compositeRegions(baseState.imageData, [], bakeLayerRef.current);
      ctx.putImageData(preRegions, 0, 0);
    } else {
      const composited = compositeRegions(baseState.imageData, regions, bakeLayerRef.current);
      ctx.putImageData(composited, 0, 0);
    }
    // S6-1: Draw shape overlay on top (preview during drag)
    if (!comparing && shapeOverlayCanvasRef.current) {
      ctx.drawImage(shapeOverlayCanvasRef.current, 0, 0);
    }
    // S8: Draw grid overlay
    if (!comparing && gridEnabled && gridSize > 0) {
      const w = canvas.width;
      const h = canvas.height;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = gridSize; x < w; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = gridSize; y < h; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  // redrawTick is intentionally included so brush strokes (ref mutations) trigger redraws
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseState, regions, comparing, redrawTick, gridEnabled, gridSize]);

  // ---------------------------------------------------------------------------
  // Image loading
  // ---------------------------------------------------------------------------

  // Fit canvas to container with clientWidth > 0 guard and one rAF retry.
  const tryFitContainer = useCallback(
    (w: number, h: number) => {
      const attempt = () => {
        const c = containerRef.current;
        if (c && c.clientWidth > 0 && c.clientHeight > 0) {
          zoom.fitToContainer(c.clientWidth, c.clientHeight, w, h);
          return true;
        }
        return false;
      };
      requestAnimationFrame(() => {
        if (!attempt()) {
          requestAnimationFrame(() => { attempt(); });
        }
      });
    },
    [zoom]
  );

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
            editorHistory.reset();
            setPalette(extractPaletteColors(imageData, 8));
            setStatus(`画像読み込み完了: ${w}x${h}`);
            // Issue #7: record recent file
            const thumb = makeThumbnail(imageData);
            addRecentFile(file.name, thumb);
            setRecentFiles(getRecentFiles());
            // B-1: auto-fit on load
            tryFitContainer(w, h);
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
        editorHistory.reset();
        setPalette(extractPaletteColors(imageData, 8));
        setStatus(`画像読み込み完了: ${w}x${h}`);
        // Issue #7: record recent file
        const thumb = makeThumbnail(imageData);
        addRecentFile(file.name, thumb);
        setRecentFiles(getRecentFiles());
        // B-1: auto-fit on load
        tryFitContainer(w, h);
      };
      img.onerror = () => {
        setStatus("画像の読み込みに失敗しました");
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
    [editorHistory, zoom, tryFitContainer]
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
  // S8: Snap helper — rounds coord to nearest grid multiple when snap is ON
  // ---------------------------------------------------------------------------

  const snapCoord = useCallback(
    (v: number): number => {
      if (!snapEnabled || gridSize <= 0) return v;
      return Math.round(v / gridSize) * gridSize;
    },
    [snapEnabled, gridSize]
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
      // brush/shape mode uses mousedown/mousemove/mouseup, not click
      if (mode === "brush" || mode === "shape") return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      const { x, y } = coords;

      // Text mode: place text input at click position (snap if enabled)
      if (mode === "text") {
        setTextDraft({ x: snapCoord(x), y: snapCoord(y), value: "" });
        // Focus will be handled by useEffect after render
        return;
      }

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
          editorHistory.push([], newBake);
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
          editorHistory.push([...regions], newBake2);
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
        editorHistory.push([...regions, newRegion], bakeLayerRef.current);
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
        editorHistory.push([...regions], newBakeF);
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

      editorHistory.push([...regions, newRegion], bakeLayerRef.current);
      if (mode !== "transparent") addRecentColor(selectedColor);
      setStatus(
        mode === "transparent"
          ? `透過: ${pixels.length}px 選択`
          : `色変更: ${pixels.length}px → ${selectedColor}`
      );
    },
    [baseState, tolerance, selectedColor, mode, spacePressed, regions, editorHistory, getCanvasCoords, includeAntialias, connectivity, smoothReplace, closeRadius, featherRadius, triggerRedraw, addRecentColor, snapCoord]
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
      sctx.save();
      sctx.globalAlpha = opacity / 100;
      if (blendMode !== "normal") sctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
      sctx.fillStyle = selectedColor;
      sctx.beginPath();
      sctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      sctx.fill();
      sctx.restore();

      // Merge stroke canvas into bakeLayer
      mergeBrushStroke(w, h);
      triggerRedraw();
    },
    [mode, spacePressed, baseState, getCanvasCoords, selectedColor, brushSize, opacity, blendMode, triggerRedraw]
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
      sctx.save();
      sctx.globalAlpha = opacity / 100;
      if (blendMode !== "normal") sctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
      sctx.strokeStyle = selectedColor;
      sctx.lineWidth = brushSize;
      sctx.lineCap = "round";
      sctx.beginPath();
      sctx.moveTo(last.x, last.y);
      sctx.lineTo(x, y);
      sctx.stroke();
      sctx.restore();

      brushLastPosRef.current = { x, y };
      mergeBrushStroke(baseState.naturalWidth, baseState.naturalHeight);
      triggerRedraw();
    },
    [mode, baseState, getCanvasCoords, selectedColor, brushSize, opacity, blendMode, triggerRedraw]
  );

  const handleBrushMouseUp = useCallback(() => {
    if (!brushDrawingRef.current) return;
    brushDrawingRef.current = false;
    brushLastPosRef.current = null;

    // Commit stroke to undo history
    editorHistory.push([...regions], bakeLayerRef.current);
    setStatus(`ブラシ描画`);
  }, [editorHistory, regions]);

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
  // S5-1: Text tool: commit draft to bake layer
  // ---------------------------------------------------------------------------

  const commitTextDraft = useCallback(
    (draft: TextDraft) => {
      if (!baseState.imageData || draft.value.trim() === "") {
        setTextDraft(null);
        return;
      }
      const w = baseState.naturalWidth;
      const h = baseState.naturalHeight;

      if (!bakeLayerRef.current) {
        bakeLayerRef.current = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
      }

      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext("2d")!;

      // Draw existing bake layer first
      ctx.putImageData(bakeLayerRef.current, 0, 0);

      // Draw text
      const fontStr = `${textFontSize}px ${textFontFamily}`;
      ctx.save();
      ctx.globalAlpha = opacity / 100;
      if (blendMode !== "normal") ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
      ctx.font = fontStr;
      ctx.textBaseline = "top";

      // S8: apply rotate + flip around text anchor point
      const textMetrics = ctx.measureText(draft.value);
      const textW = textMetrics.width;
      const textH = textFontSize;
      const textCx = draft.x + textW / 2;
      const textCy = draft.y + textH / 2;
      ctx.translate(textCx, textCy);
      if (draftRotateDeg !== 0) ctx.rotate((draftRotateDeg * Math.PI) / 180);
      if (draftFlipX) ctx.scale(-1, 1);
      if (draftFlipY) ctx.scale(1, -1);
      ctx.translate(-textCx, -textCy);

      if (useFill) {
        if (fillType === "linearGradient") {
          // Measure text to approximate bounding box for gradient
          applyLinearGradient(ctx, draft.x, draft.y, textW, textH, gradientConfig.stops, gradientConfig.angle);
        } else if (fillType === "radialGradient") {
          applyRadialGradient(ctx, draft.x, draft.y, textW, textH, gradientConfig.stops);
        } else {
          ctx.fillStyle = selectedColor;
        }
        ctx.fillText(draft.value, draft.x, draft.y);
      }
      if (useStroke && strokeWidth > 0) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.strokeText(draft.value, draft.x, draft.y);
      }
      ctx.restore();

      const newBake = ctx.getImageData(0, 0, w, h);
      bakeLayerRef.current = newBake;
      editorHistory.push([...regions], newBake);
      triggerRedraw();
      addRecentColor(selectedColor);
      setStatus(`テキスト描画: "${draft.value}"`);
      setTextDraft(null);
    },
    [baseState, selectedColor, strokeColor, strokeWidth, useFill, useStroke, textFontFamily, textFontSize, opacity, blendMode, fillType, gradientConfig, regions, editorHistory, triggerRedraw, addRecentColor, draftRotateDeg, draftFlipX, draftFlipY]
  );

  // ---------------------------------------------------------------------------
  // S6-1: Shape tool: draw draft overlay
  // ---------------------------------------------------------------------------

  const drawShapeOverlay = useCallback(
    (draft: ShapeDraft) => {
      if (!baseState.imageData) return;
      const w = baseState.naturalWidth;
      const h = baseState.naturalHeight;

      // Ensure overlay canvas exists and matches image size
      if (!shapeOverlayCanvasRef.current ||
          shapeOverlayCanvasRef.current.width !== w ||
          shapeOverlayCanvasRef.current.height !== h) {
        const oc = document.createElement("canvas");
        oc.width = w;
        oc.height = h;
        shapeOverlayCanvasRef.current = oc;
      }

      const oc = shapeOverlayCanvasRef.current;
      const octx = oc.getContext("2d")!;
      octx.clearRect(0, 0, w, h);

      const { x, y, w: bw, h: bh } = normalizeBbox(draft.startX, draft.startY, draft.endX, draft.endY);
      drawShape(
        octx,
        shapeKind,
        x, y, bw, bh,
        useFill ? selectedColor : null,
        useStroke && strokeWidth > 0 ? strokeColor : null,
        strokeWidth,
        polyVertices
      );

      // Merge overlay into bake for preview via triggerRedraw
      // We store overlay in a separate ref and composite in the redraw effect
    },
    [baseState, shapeKind, selectedColor, strokeColor, strokeWidth, useFill, useStroke, polyVertices]
  );

  const commitShapeDraft = useCallback(
    (draft: ShapeDraft) => {
      if (!baseState.imageData) return;
      const w = baseState.naturalWidth;
      const h = baseState.naturalHeight;
      const { x, y, w: bw, h: bh } = normalizeBbox(draft.startX, draft.startY, draft.endX, draft.endY);
      if (bw < 2 && bh < 2) {
        shapeDraftRef.current = null;
        triggerRedraw();
        return;
      }

      if (!bakeLayerRef.current) {
        bakeLayerRef.current = new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
      }

      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext("2d")!;
      ctx.putImageData(bakeLayerRef.current, 0, 0);

      // S7: apply opacity + blend mode
      ctx.save();
      ctx.globalAlpha = opacity / 100;
      if (blendMode !== "normal") ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;

      // S8: apply rotate + flip around shape bounding box center
      const shapeCx = x + bw / 2;
      const shapeCy = y + bh / 2;
      ctx.translate(shapeCx, shapeCy);
      if (draftRotateDeg !== 0) ctx.rotate((draftRotateDeg * Math.PI) / 180);
      if (draftFlipX) ctx.scale(-1, 1);
      if (draftFlipY) ctx.scale(1, -1);
      ctx.translate(-shapeCx, -shapeCy);

      // S7: apply gradient fill if selected
      if (useFill && fillType !== "solid" && bw > 0 && bh > 0) {
        ctx.save();
        ctx.beginPath();
        // Build shape path
        if (shapeKind === "rect") {
          ctx.rect(x, y, bw, bh);
        } else if (shapeKind === "circle") {
          ctx.ellipse(x + bw / 2, y + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
        } else {
          const n = Math.max(3, Math.min(12, polyVertices));
          const cx2 = x + bw / 2; const cy2 = y + bh / 2;
          const rx2 = bw / 2; const ry2 = bh / 2;
          if (shapeKind === "polygon") {
            for (let i = 0; i < n; i++) {
              const angle2 = (Math.PI * 2 * i) / n - Math.PI / 2;
              const px2 = cx2 + rx2 * Math.cos(angle2);
              const py2 = cy2 + ry2 * Math.sin(angle2);
              if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
            }
            ctx.closePath();
          } else { // star
            const outerRx = bw / 2; const outerRy = bh / 2;
            const innerRx = outerRx * 0.4; const innerRy = outerRy * 0.4;
            for (let i = 0; i < 10; i++) {
              const angle2 = (Math.PI * i) / 5 - Math.PI / 2;
              const rx3 = i % 2 === 0 ? outerRx : innerRx;
              const ry3 = i % 2 === 0 ? outerRy : innerRy;
              const px3 = cx2 + rx3 * Math.cos(angle2);
              const py3 = cy2 + ry3 * Math.sin(angle2);
              if (i === 0) ctx.moveTo(px3, py3); else ctx.lineTo(px3, py3);
            }
            ctx.closePath();
          }
        }
        if (fillType === "linearGradient") {
          applyLinearGradient(ctx, x, y, bw, bh, gradientConfig.stops, gradientConfig.angle);
        } else {
          applyRadialGradient(ctx, x, y, bw, bh, gradientConfig.stops);
        }
        ctx.fill();
        if (useStroke && strokeWidth > 0) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.stroke();
        }
        ctx.restore();
      } else {
        drawShape(
          ctx,
          shapeKind,
          x, y, bw, bh,
          useFill ? selectedColor : null,
          useStroke && strokeWidth > 0 ? strokeColor : null,
          strokeWidth,
          polyVertices
        );
      }
      ctx.restore();

      const newBake = ctx.getImageData(0, 0, w, h);
      bakeLayerRef.current = newBake;
      editorHistory.push([...regions], newBake);

      shapeDraftRef.current = null;
      if (shapeOverlayCanvasRef.current) {
        const oc = shapeOverlayCanvasRef.current;
        const octx = oc.getContext("2d")!;
        octx.clearRect(0, 0, oc.width, oc.height);
      }
      triggerRedraw();
      addRecentColor(selectedColor);
      setStatus(`シェイプ描画: ${shapeKind}`);
    },
    [baseState, shapeKind, selectedColor, strokeColor, strokeWidth, useFill, useStroke, polyVertices, opacity, blendMode, fillType, gradientConfig, regions, editorHistory, triggerRedraw, addRecentColor, draftRotateDeg, draftFlipX, draftFlipY]
  );

  // ---------------------------------------------------------------------------
  // S6-1: Shape mouse handlers
  // ---------------------------------------------------------------------------

  const handleShapeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode !== "shape" || spacePressed || !baseState.imageData) return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      const sx = snapCoord(coords.x);
      const sy = snapCoord(coords.y);
      shapeDraftRef.current = { startX: sx, startY: sy, endX: sx, endY: sy, active: true };
    },
    [mode, spacePressed, baseState, getCanvasCoords, snapCoord]
  );

  const handleShapeMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode !== "shape" || !shapeDraftRef.current?.active || !baseState.imageData) return;
      const coords = getCanvasCoords(e);
      if (!coords) return;
      let x = snapCoord(coords.x);
      let y = snapCoord(coords.y);
      const draft = shapeDraftRef.current;

      // Shift: constrain to square/circle
      if (e.shiftKey) {
        const dx = x - draft.startX;
        const dy = y - draft.startY;
        const size = Math.min(Math.abs(dx), Math.abs(dy));
        x = draft.startX + Math.sign(dx) * size;
        y = draft.startY + Math.sign(dy) * size;
      }

      shapeDraftRef.current = { ...draft, endX: x, endY: y };
      drawShapeOverlay(shapeDraftRef.current);
      triggerRedraw();
    },
    [mode, baseState, getCanvasCoords, drawShapeOverlay, triggerRedraw, snapCoord]
  );

  const handleShapeMouseUp = useCallback(
    () => {
      if (mode !== "shape" || !shapeDraftRef.current?.active) return;
      const draft = shapeDraftRef.current;
      shapeDraftRef.current = { ...draft, active: false };
      commitShapeDraft(draft);
    },
    [mode, commitShapeDraft]
  );

  // ---------------------------------------------------------------------------
  // Remove a specific region by id (mapping table undo)
  // ---------------------------------------------------------------------------

  const handleRemoveRegion = useCallback(
    (id: string) => {
      const next = regions.filter((r) => r.id !== id);
      editorHistory.push(next, bakeLayerRef.current);
      setStatus("リージョンを削除しました");
    },
    [regions, editorHistory]
  );

  // ---------------------------------------------------------------------------
  // S8: Center-align draft helpers — reposition textDraft or shapeDraft to canvas center
  // ---------------------------------------------------------------------------

  const centerAlignDraftH = useCallback(() => {
    if (!baseState.imageData) return;
    const w = baseState.naturalWidth;
    setTextDraft((d) => d ? { ...d, x: Math.round(w / 2) } : null);
    if (shapeDraftRef.current) {
      const draft = shapeDraftRef.current;
      const bw = Math.abs(draft.endX - draft.startX);
      const newStartX = Math.round((w - bw) / 2);
      shapeDraftRef.current = { ...draft, startX: newStartX, endX: newStartX + bw };
      drawShapeOverlay(shapeDraftRef.current);
      triggerRedraw();
    }
  }, [baseState, drawShapeOverlay, triggerRedraw]);

  const centerAlignDraftV = useCallback(() => {
    if (!baseState.imageData) return;
    const h = baseState.naturalHeight;
    setTextDraft((d) => d ? { ...d, y: Math.round(h / 2) } : null);
    if (shapeDraftRef.current) {
      const draft = shapeDraftRef.current;
      const bh = Math.abs(draft.endY - draft.startY);
      const newStartY = Math.round((h - bh) / 2);
      shapeDraftRef.current = { ...draft, startY: newStartY, endY: newStartY + bh };
      drawShapeOverlay(shapeDraftRef.current);
      triggerRedraw();
    }
  }, [baseState, drawShapeOverlay, triggerRedraw]);

  const centerAlignDraftBoth = useCallback(() => {
    if (!baseState.imageData) return;
    const w = baseState.naturalWidth;
    const h = baseState.naturalHeight;
    setTextDraft((d) => d ? { ...d, x: Math.round(w / 2), y: Math.round(h / 2) } : null);
    if (shapeDraftRef.current) {
      const draft = shapeDraftRef.current;
      const bw = Math.abs(draft.endX - draft.startX);
      const bh = Math.abs(draft.endY - draft.startY);
      const newStartX = Math.round((w - bw) / 2);
      const newStartY = Math.round((h - bh) / 2);
      shapeDraftRef.current = { ...draft, startX: newStartX, endX: newStartX + bw, startY: newStartY, endY: newStartY + bh };
      drawShapeOverlay(shapeDraftRef.current);
      triggerRedraw();
    }
  }, [baseState, drawShapeOverlay, triggerRedraw]);

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
            editorHistory.reset();
            setPalette(extractPaletteColors(imageData, 8));
            setStatus(`クリップボードから読み込み: ${w}x${h}`);
            // auto-fit on paste
            tryFitContainer(w, h);
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
  }, [editorHistory, zoom, tryFitContainer]);

  // ---------------------------------------------------------------------------
  // Issue #8: Copy composited canvas to clipboard as PNG
  // ---------------------------------------------------------------------------

  const handleCopyToClipboard = useCallback(() => {
    if (!baseState.imageData) return;
    if (!navigator.clipboard?.write) {
      showToast("クリップボードAPIが利用できません", "error");
      return;
    }
    const composited = compositeRegions(baseState.imageData, regions, bakeLayerRef.current);
    const offscreen = document.createElement("canvas");
    offscreen.width = composited.width;
    offscreen.height = composited.height;
    const ctx = offscreen.getContext("2d")!;
    ctx.putImageData(composited, 0, 0);
    offscreen.toBlob((blob) => {
      if (!blob) {
        showToast("画像の変換に失敗しました", "error");
        return;
      }
      navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(() => {
        showToast("画像をクリップボードにコピーしました");
      }).catch(() => {
        showToast("クリップボードへのコピーに失敗しました", "error");
      });
    }, "image/png");
  }, [baseState.imageData, regions, bakeLayerRef, showToast]);

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
    editorHistory.push([...regions, newRegion], bakeLayerRef.current);
    setStatus(`白を透過: ${pixels.length}px`);
    showToast(`白を透過しました (${pixels.length}px)`);
  }, [baseState.imageData, regions, editorHistory, showToast]);

  // ---------------------------------------------------------------------------
  // Issue #9: Canvas size change (crop / scale)
  // ---------------------------------------------------------------------------

  const handleCanvasSizeApply = useCallback(
    (newW: number, newH: number, anchor: AnchorPosition, mode: ResizeMode) => {
      if (!baseState.imageData) return;

      const oldW = baseState.naturalWidth;
      const oldH = baseState.naturalHeight;

      // Transform base ImageData
      const newBaseImageData =
        mode === "crop"
          ? cropImageData(baseState.imageData, newW, newH, anchor)
          : scaleImageData(baseState.imageData, newW, newH);

      // Transform bakeLayer if present
      let newBakeLayer: ImageData | null = null;
      if (bakeLayerRef.current) {
        newBakeLayer =
          mode === "crop"
            ? cropImageData(bakeLayerRef.current, newW, newH, anchor)
            : scaleImageData(bakeLayerRef.current, newW, newH);
      }

      // Transform all regions
      const newRegions = regions.map((r) =>
        mode === "crop"
          ? cropRegion(r, oldW, oldH, newW, newH, anchor)
          : scaleRegion(r, oldW, oldH, newW, newH)
      );

      // Update bakeLayerRef before push so history snapshot captures new layer
      bakeLayerRef.current = newBakeLayer;

      // Commit as a single undo-able action
      editorHistory.push(newRegions, newBakeLayer);

      setBaseState({
        imageData: newBaseImageData,
        naturalWidth: newW,
        naturalHeight: newH,
      });

      setCanvasSizeModalOpen(false);
      setStatus(`キャンバスサイズ変更: ${newW} × ${newH} px`);
      showToast(`キャンバスサイズ: ${newW} × ${newH}`);
    },
    [baseState, regions, editorHistory, showToast]
  );

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
  // S5-2: Palette sets
  // ---------------------------------------------------------------------------

  const handleAddPaletteSet = useCallback(() => {
    const name = `パレット${paletteSets.length + 1}`;
    const newSet: PaletteSet = { id: `ps-${Date.now()}`, name, colors: [] };
    setPaletteSets((prev) => {
      const next = [...prev, newSet].slice(-PALETTE_SETS_MAX);
      savePaletteSets(next);
      return next;
    });
    setActivePaletteSetId(newSet.id);
  }, [paletteSets.length]);

  const handleAddColorToPaletteSet = useCallback((setId: string) => {
    setPaletteSets((prev) => {
      const next = prev.map((ps) => {
        if (ps.id !== setId) return ps;
        if (ps.colors.includes(selectedColor)) return ps;
        return { ...ps, colors: [...ps.colors, selectedColor].slice(0, 16) };
      });
      savePaletteSets(next);
      return next;
    });
  }, [selectedColor]);

  const handleRemoveColorFromPaletteSet = useCallback((setId: string, hex: string) => {
    setPaletteSets((prev) => {
      const next = prev.map((ps) => {
        if (ps.id !== setId) return ps;
        return { ...ps, colors: ps.colors.filter((c) => c !== hex) };
      });
      savePaletteSets(next);
      return next;
    });
  }, []);

  const handleDeletePaletteSet = useCallback((setId: string) => {
    setPaletteSets((prev) => {
      const next = prev.filter((ps) => ps.id !== setId);
      savePaletteSets(next);
      return next;
    });
    setActivePaletteSetId((prev) => (prev === setId ? null : prev));
  }, []);


  // ---------------------------------------------------------------------------
  // Export handlers
  // ---------------------------------------------------------------------------

  const handleExportSvg = useCallback(() => {
    if (!baseState.imageData) return;
    let usedFallback = false;
    const svgString = buildSvg(
      baseState.imageData,
      regions,
      baseState.naturalWidth,
      baseState.naturalHeight,
      () => { usedFallback = true; }
    );
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.svg";
    a.click();
    URL.revokeObjectURL(url);
    if (usedFallback) {
      setStatus("SVGをエクスポートしました (大領域のため矩形で近似)");
      showToast("大領域のため矩形パスで出力しました", "error");
    } else {
      setStatus("SVGをエクスポートしました");
      showToast("SVGをエクスポートしました");
    }
  }, [baseState, regions, showToast]);

  const handleExport = useCallback((options: ExportOptions) => {
    if (!baseState.imageData) return;
    const composited = compositeRegions(baseState.imageData, regions, bakeLayerRef.current);
    const { width, height } = calcOutputSize(
      baseState.naturalWidth,
      baseState.naturalHeight,
      options
    );
    const mimeType = getMimeType(options.format);
    const ext = getFileExtension(options.format);
    const filename = `export_${width}x${height}.${ext}`;
    exportImageData(composited, width, height, mimeType, options.quality, filename);
    const label = options.format.toUpperCase();
    setStatus(`${label}をエクスポートしました (${width}×${height})`);
    showToast(`${label}をエクスポートしました (${width}×${height})`);
  }, [baseState, regions, showToast]);

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
  // Issue #5: Project save / load
  // ---------------------------------------------------------------------------

  const handleSaveProject = useCallback(() => {
    if (!baseState.imageData) return;
    try {
      const project = serializeProject({
        imageData: baseState.imageData,
        naturalWidth: baseState.naturalWidth,
        naturalHeight: baseState.naturalHeight,
        regions,
        bakeLayer: bakeLayerRef.current,
        selectedColor,
        tolerance,
      });
      downloadChocoFile(project);
      autoSave.clearAutoSave();
      setStatus("プロジェクトを保存しました (.choco)");
      showToast("プロジェクトを保存しました (.choco)");
    } catch (err) {
      setStatus("プロジェクトの保存に失敗しました");
      showToast("プロジェクトの保存に失敗しました", "error");
      console.error("[handleSaveProject]", err);
    }
  }, [baseState, regions, selectedColor, tolerance, autoSave, showToast]);

  const handleLoadProject = useCallback(async () => {
    try {
      const raw = await openChocoFile();
      const state = await deserializeProject(raw);
      setBaseState({
        imageData: state.imageData,
        naturalWidth: state.naturalWidth,
        naturalHeight: state.naturalHeight,
      });
      editorHistory.reset();
      // Restore regions via history so undo works correctly
      editorHistory.push(state.regions, state.bakeLayer ?? null);
      bakeLayerRef.current = state.bakeLayer;
      setSelectedColor(state.selectedColor);
      setTolerance(state.tolerance);
      setPalette(extractPaletteColors(state.imageData, 8));
      setStatus("プロジェクトを読み込みました");
      showToast("プロジェクトを読み込みました");
      tryFitContainer(state.naturalWidth, state.naturalHeight);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "不明なエラー";
      setStatus("読込失敗: " + msg);
      showToast("プロジェクトの読込に失敗しました", "error");
      console.error("[handleLoadProject]", err);
    }
  }, [editorHistory, showToast, tryFitContainer]);

  const handleRestoreAutoSave = useCallback(async () => {
    setShowRestoreModal(false);
    try {
      const state = await autoSave.loadAutoSave();
      if (!state) {
        setStatus("前回の編集が見つかりませんでした");
        return;
      }
      // Autosave is image-omitted (lite format): restore regions and settings only.
      // imageData is null — the user must reload the original image separately.
      setBaseState({
        imageData: null,
        naturalWidth: state.naturalWidth,
        naturalHeight: state.naturalHeight,
      });
      editorHistory.reset();
      editorHistory.push(state.regions, null);
      bakeLayerRef.current = null;
      setSelectedColor(state.selectedColor);
      setTolerance(state.tolerance);
      setStatus("リージョンと設定を復元しました。元画像を再読み込みしてください");
      showToast("リージョンと設定を復元しました。元画像を再読み込みしてください", "info");
    } catch (err) {
      setStatus("復元に失敗しました");
      showToast("復元に失敗しました", "error");
      console.error("[handleRestoreAutoSave]", err);
    }
  }, [autoSave, editorHistory, showToast]);

  // Issue #5: Ctrl+S / Ctrl+O global shortcuts (defined after handlers to avoid forward ref)
  useEffect(() => {
    const handleProjectShortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        handleSaveProject();
      } else if (e.ctrlKey && e.key === "o") {
        e.preventDefault();
        handleLoadProject();
      }
    };
    window.addEventListener("keydown", handleProjectShortcut);
    return () => window.removeEventListener("keydown", handleProjectShortcut);
  }, [handleSaveProject, handleLoadProject]);

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
          : mode === "text"
            ? "text"
            : mode === "shape"
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
    mode === "text" ? "テキスト / Text" :
    mode === "shape" ? "シェイプ / Shape" :
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
      {/* ===== Property Bar (top, full-width) — 2-row layout ===== */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: T.color.bgPanel,
          borderBottom: `1px solid ${T.color.border}`,
          flexShrink: 0,
        }}
      >
        {/* --- Upper row: always-visible common controls --- */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: T.space.xs,
            padding: `5px ${T.space.sm}px`,
            flexWrap: "wrap",
            borderBottom: `1px solid ${T.color.border}`,
          }}
        >
          {/* File open */}
          <Tooltip label="画像を開く">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={iconBtnStyle}
              aria-label="画像を開く"
            >
              <FolderOpen size={16} />
            </button>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />

          {/* Issue #5: Project save */}
          <Tooltip label="プロジェクト保存 (.choco)" shortcut="Ctrl+S">
            <button
              type="button"
              onClick={handleSaveProject}
              disabled={!baseState.imageData}
              style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
              aria-label="プロジェクト保存"
            >
              <Save size={16} />
            </button>
          </Tooltip>

          {/* Issue #5: Project load */}
          <Tooltip label="プロジェクト読込 (.choco)" shortcut="Ctrl+O">
            <button
              type="button"
              onClick={handleLoadProject}
              style={iconBtnStyle}
              aria-label="プロジェクト読込"
            >
              <FolderInput size={16} />
            </button>
          </Tooltip>

          {/* Issue #7: Recent files dropdown */}
          <div ref={recentMenuRef} style={{ position: "relative" }}>
            <Tooltip label="最近開いたファイル">
              <button
                type="button"
                onClick={() => setRecentMenuOpen((v) => !v)}
                style={recentFiles.length === 0 ? { ...iconBtnStyle, opacity: 0.35 } : iconBtnStyle}
                aria-label="最近開いたファイル"
                aria-haspopup="listbox"
                aria-expanded={recentMenuOpen}
              >
                <Clock size={16} />
              </button>
            </Tooltip>
            {recentMenuOpen && recentFiles.length > 0 && (
              <div
                role="listbox"
                aria-label="最近開いたファイル一覧"
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  zIndex: 200,
                  background: T.color.bgElevated,
                  border: `1px solid ${T.color.borderMid}`,
                  borderRadius: T.radius.md,
                  boxShadow: T.shadow.elevated,
                  minWidth: 220,
                  padding: "4px 0",
                }}
              >
                {recentFiles.map((entry) => (
                  <button
                    key={entry.name + entry.lastAccessedAt}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      setRecentMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: T.space.sm,
                      width: "100%",
                      padding: `${T.space.xs}px ${T.space.sm}px`,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: T.color.textPrimary,
                      fontFamily: T.font.family,
                      fontSize: T.font.body,
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = T.color.bgPanel;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    }}
                  >
                    <img
                      src={entry.thumbnailDataUrl}
                      alt=""
                      aria-hidden="true"
                      style={{
                        width: 32,
                        height: 32,
                        objectFit: "contain",
                        borderRadius: T.radius.sm,
                        border: `1px solid ${T.color.border}`,
                        background: T.color.checkerA,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ overflow: "hidden", flex: 1 }}>
                      <div
                        style={{
                          fontSize: T.font.body,
                          color: T.color.textPrimary,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {entry.name}
                      </div>
                      <div style={{ fontSize: T.font.badge, color: T.color.textMuted }}>
                        {formatRelativeTime(entry.lastAccessedAt)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={dividerStyle} />

          {/* Undo / Redo / Reset */}
          <Tooltip label="元に戻す" shortcut="Ctrl+Z">
            <button
              type="button"
              onClick={() => { editorHistory.undo(); triggerRedraw(); setStatus("元に戻しました"); }}
              disabled={!editorHistory.canUndo}
              style={!editorHistory.canUndo ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
              aria-label="元に戻す"
            >
              <Undo2 size={16} />
            </button>
          </Tooltip>
          <Tooltip label="やり直し" shortcut="Ctrl+Y">
            <button
              type="button"
              onClick={() => { editorHistory.redo(); triggerRedraw(); setStatus("やり直しました"); }}
              disabled={!editorHistory.canRedo}
              style={!editorHistory.canRedo ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
              aria-label="やり直し"
            >
              <Redo2 size={16} />
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={() => { editorHistory.reset(); triggerRedraw(); setStatus("全リセット完了"); }}
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
              <Maximize2 size={16} />
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
              <FileCode2 size={16} />
            </button>
          </Tooltip>

          {/* Export image modal trigger */}
          <Tooltip label="画像出力 (PNG/JPEG/WebP)">
            <button
              type="button"
              onClick={() => setExportModalOpen(true)}
              disabled={!baseState.imageData}
              style={!baseState.imageData ? { ...iconBtnSuccessStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnSuccessStyle}
              aria-label="画像出力"
            >
              <Download size={16} />
            </button>
          </Tooltip>

          {/* Issue #8: Copy canvas to clipboard */}
          <Tooltip label="クリップボードにコピー (Ctrl+C)">
            <button
              type="button"
              onClick={handleCopyToClipboard}
              disabled={!baseState.imageData}
              style={!baseState.imageData ? { ...iconBtnSuccessStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnSuccessStyle}
              aria-label="クリップボードにコピー"
            >
              <Copy size={16} />
            </button>
          </Tooltip>

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
              <Wand2 size={16} />
            </button>
          </Tooltip>

          {/* Issue #9: Canvas size */}
          <Tooltip label="キャンバスサイズ変更">
            <button
              type="button"
              onClick={() => setCanvasSizeModalOpen(true)}
              disabled={!baseState.imageData}
              style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
              aria-label="キャンバスサイズ変更"
            >
              <Frame size={16} />
            </button>
          </Tooltip>

          <div style={dividerStyle} />

          {/* S7: Opacity slider */}
          <Tooltip label="不透明度">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Droplets size={14} style={{ color: T.color.textMuted, flexShrink: 0 }} />
            </span>
          </Tooltip>
          <span style={labelStyle}>{opacity}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            style={{ width: 62 }}
            title={`不透明度: ${opacity}%`}
          />

          {/* S7: Blend mode */}
          <Tooltip label="ブレンドモード">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Layers size={14} style={{ color: T.color.textMuted, flexShrink: 0 }} />
            </span>
          </Tooltip>
          <select
            value={blendMode}
            onChange={(e) => setBlendMode(e.target.value as "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten")}
            style={selectStyle}
            title="ブレンドモード"
          >
            <option value="normal">通常</option>
            <option value="multiply">乗算</option>
            <option value="screen">スクリーン</option>
            <option value="overlay">オーバーレイ</option>
            <option value="darken">暗く</option>
            <option value="lighten">明るく</option>
          </select>

          <div style={dividerStyle} />

          {/* S8: Grid + Snap controls */}
          <Tooltip label="グリッド表示">
            <button
              type="button"
              onClick={() => setGridEnabled((v) => !v)}
              style={gridEnabled ? { ...iconBtnStyle, background: T.color.accent, border: `1px solid ${T.color.accent}` } : iconBtnStyle}
              aria-label="グリッド表示"
              aria-pressed={gridEnabled}
            >
              <Grid3x3 size={16} />
            </button>
          </Tooltip>
          {gridEnabled && (
            <>
              <span style={labelStyle}>間隔: {gridSize}</span>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={gridSize}
                onChange={(e) => setGridSize(Number(e.target.value))}
                style={{ width: 62 }}
                title={`グリッド間隔: ${gridSize}px`}
              />
            </>
          )}
          <Tooltip label="スナップ">
            <button
              type="button"
              onClick={() => setSnapEnabled((v) => !v)}
              style={snapEnabled ? { ...iconBtnStyle, background: T.color.accent, border: `1px solid ${T.color.accent}` } : iconBtnStyle}
              aria-label="スナップ"
              aria-pressed={snapEnabled}
            >
              <Magnet size={16} />
            </button>
          </Tooltip>

          <div style={dividerStyle} />

          {/* Before/after comparison */}
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
        </div>

        {/* --- Lower row: mode-specific controls (hidden for eyedropper) --- */}
        {mode !== "eyedropper" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: T.space.xs,
              padding: `4px ${T.space.sm}px`,
              flexWrap: "wrap",
            }}
          >
            {/* Color swatch + HSV picker — color / replace-all / brush modes */}
            {(mode === "color" || mode === "replace-all" || mode === "brush") && (
              <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 2 }}>
                <button
                  ref={colorSwatchRef}
                  type="button"
                  onClick={() => setHsvPickerOpen((v) => !v)}
                  style={{
                    width: 24,
                    height: 24,
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
                <input
                  type="color"
                  value={selectedColor}
                  onChange={(e) => {
                    setSelectedColor(e.target.value);
                    setHsvPickerOpen(false);
                  }}
                  style={{
                    width: 16,
                    height: 16,
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

            {/* Brush size — brush mode only */}
            {mode === "brush" && (
              <>
                <span style={labelStyle}>太さ: {brushSize}</span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  style={{ width: 72 }}
                  title="ブラシサイズ (1-100px)"
                />
              </>
            )}

            {/* Tolerance — color / replace-all / transparent modes */}
            {(mode === "color" || mode === "replace-all" || mode === "transparent") && (
              <>
                <span style={labelStyle}>許容値: {tolerance}</span>
                <input
                  type="range"
                  min={0}
                  max={128}
                  value={tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                  style={{ width: 72 }}
                  title="色許容値"
                />
              </>
            )}

            {/* Hole-fill — color / replace-all / transparent modes */}
            {(mode === "color" || mode === "replace-all" || mode === "transparent") && (
              <>
                <span style={labelStyle}>穴埋め: {closeRadius}</span>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={closeRadius}
                  onChange={(e) => setCloseRadius(Number(e.target.value))}
                  style={{ width: 54 }}
                  title="穴埋め半径 (0=OFF, クロージング半径 1-5)"
                />
              </>
            )}

            {/* Feather radius — transparent mode */}
            {mode === "transparent" && (
              <>
                <span style={labelStyle}>フェザー: {featherRadius}</span>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={1}
                  value={featherRadius}
                  onChange={(e) => setFeatherRadius(Number(e.target.value))}
                  style={{ width: 62 }}
                  title="フェザー (境界ぼかし) 0=OFF, 1-20px"
                />
              </>
            )}

            {/* Smooth replace — replace-all mode only */}
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

            {/* Antialias boundary — color / transparent modes */}
            {(mode === "color" || mode === "transparent") && (
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

            {/* 8-neighbor connectivity — color / transparent modes */}
            {(mode === "color" || mode === "transparent") && (
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

            {/* Save brand swatch — color/replace-all mode */}
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

            {/* S5-1: Text tool options */}
            {mode === "text" && (
              <>
                <select
                  value={textFontFamily}
                  onChange={(e) => setTextFontFamily(e.target.value)}
                  style={selectStyle}
                  title="フォント"
                >
                  <option value="sans-serif">Sans-serif</option>
                  <option value="serif">Serif</option>
                  <option value="monospace">Monospace</option>
                  <option value="'Noto Sans JP', sans-serif">Noto Sans JP</option>
                  <option value="cursive">Cursive</option>
                  <option value="fantasy">Fantasy</option>
                </select>
                <span style={labelStyle}>サイズ: {textFontSize}</span>
                <input
                  type="range"
                  min={10}
                  max={200}
                  value={textFontSize}
                  onChange={(e) => setTextFontSize(Number(e.target.value))}
                  style={{ width: 72 }}
                  title="フォントサイズ (10-200px)"
                />
              </>
            )}

            {/* S6-1: Shape kind selector */}
            {mode === "shape" && (
              <>
                <select
                  value={shapeKind}
                  onChange={(e) => setShapeKind(e.target.value as ShapeKind)}
                  style={selectStyle}
                  title="シェイプの種類"
                >
                  <option value="rect">矩形</option>
                  <option value="circle">楕円</option>
                  <option value="polygon">多角形</option>
                  <option value="star">星</option>
                </select>
                {shapeKind === "polygon" && (
                  <>
                    <span style={labelStyle}>辺数: {polyVertices}</span>
                    <input
                      type="range"
                      min={3}
                      max={12}
                      value={polyVertices}
                      onChange={(e) => setPolyVertices(Number(e.target.value))}
                      style={{ width: 54 }}
                      title="多角形の辺数 (3-12)"
                    />
                  </>
                )}
              </>
            )}

            {/* S6-2: Stroke/Fill options — text and shape modes */}
            {(mode === "text" || mode === "shape") && (
              <>
                <div style={dividerStyle} />
                <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={useFill}
                    onChange={(e) => setUseFill(e.target.checked)}
                    style={{ cursor: "pointer" }}
                  />
                  塗り
                </label>
                <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={useStroke}
                    onChange={(e) => setUseStroke(e.target.checked)}
                    style={{ cursor: "pointer" }}
                  />
                  線
                </label>
                {useStroke && (
                  <>
                    <input
                      type="color"
                      value={strokeColor}
                      onChange={(e) => setStrokeColor(e.target.value)}
                      style={{
                        width: 24,
                        height: 24,
                        cursor: "pointer",
                        border: `1px solid ${T.color.borderMid}`,
                        borderRadius: T.radius.sm,
                        background: "none",
                        padding: 0,
                        outline: "none",
                      }}
                      title="線色"
                    />
                    <span style={labelStyle}>線幅: {strokeWidth}</span>
                    <input
                      type="range"
                      min={0}
                      max={20}
                      value={strokeWidth}
                      onChange={(e) => setStrokeWidth(Number(e.target.value))}
                      style={{ width: 62 }}
                      title="線幅 (0-20px)"
                    />
                  </>
                )}
              </>
            )}

            {/* S7: Gradient fill button — brush/text/shape modes */}
            {(mode === "brush" || mode === "text" || mode === "shape") && (
              <>
                <div style={dividerStyle} />
                <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                  <Tooltip label="グラデーション設定">
                    <button
                      type="button"
                      onClick={() => setGradientEditorOpen((v) => !v)}
                      style={{
                        ...iconBtnStyle,
                        background: gradientEditorOpen ? T.color.accent : T.color.bgElevated,
                        border: `1px solid ${gradientEditorOpen ? T.color.accent : T.color.borderMid}`,
                        padding: "0 6px",
                        width: "auto",
                        gap: 4,
                        fontSize: T.font.label,
                      }}
                      aria-label="グラデーション設定"
                    >
                      <span style={{
                        width: 14,
                        height: 14,
                        borderRadius: 2,
                        background: fillType === "solid"
                          ? selectedColor
                          : fillType === "linearGradient"
                            ? `linear-gradient(90deg, ${gradientConfig.stops[0]?.color ?? "#ff0000"}, ${gradientConfig.stops[gradientConfig.stops.length - 1]?.color ?? "#0000ff"})`
                            : `radial-gradient(circle, ${gradientConfig.stops[0]?.color ?? "#ff0000"}, ${gradientConfig.stops[gradientConfig.stops.length - 1]?.color ?? "#0000ff"})`,
                        border: `1px solid ${T.color.borderMid}`,
                        flexShrink: 0,
                        display: "inline-block",
                      }} />
                      塗り
                    </button>
                  </Tooltip>
                  {gradientEditorOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 300 }}>
                      <GradientEditor
                        fillType={fillType}
                        gradientConfig={gradientConfig}
                        onFillTypeChange={setFillType}
                        onGradientConfigChange={setGradientConfig}
                        onClose={() => setGradientEditorOpen(false)}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            {/* S8: Rotate + Flip + Align — shape/text modes only */}
            {(mode === "shape" || mode === "text") && (
              <>
                <div style={dividerStyle} />
                <Tooltip label="回転角度">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <RotateCw size={14} style={{ color: T.color.textMuted, flexShrink: 0 }} />
                  </span>
                </Tooltip>
                <span style={labelStyle}>{draftRotateDeg}°</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={draftRotateDeg}
                  onChange={(e) => setDraftRotateDeg(Number(e.target.value))}
                  style={{ width: 72 }}
                  title={`回転: ${draftRotateDeg}°`}
                />
                <Tooltip label="水平反転">
                  <button
                    type="button"
                    onClick={() => setDraftFlipX((v) => !v)}
                    style={draftFlipX ? { ...iconBtnStyle, background: T.color.accent, border: `1px solid ${T.color.accent}` } : iconBtnStyle}
                    aria-label="水平反転"
                    aria-pressed={draftFlipX}
                  >
                    <FlipHorizontal2 size={16} />
                  </button>
                </Tooltip>
                <Tooltip label="垂直反転">
                  <button
                    type="button"
                    onClick={() => setDraftFlipY((v) => !v)}
                    style={draftFlipY ? { ...iconBtnStyle, background: T.color.accent, border: `1px solid ${T.color.accent}` } : iconBtnStyle}
                    aria-label="垂直反転"
                    aria-pressed={draftFlipY}
                  >
                    <FlipVertical2 size={16} />
                  </button>
                </Tooltip>
                <div style={dividerStyle} />
                <Tooltip label="水平中央揃え">
                  <button
                    type="button"
                    onClick={centerAlignDraftH}
                    disabled={!baseState.imageData}
                    style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
                    aria-label="水平中央揃え"
                  >
                    <AlignCenterHorizontal size={16} />
                  </button>
                </Tooltip>
                <Tooltip label="垂直中央揃え">
                  <button
                    type="button"
                    onClick={centerAlignDraftV}
                    disabled={!baseState.imageData}
                    style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
                    aria-label="垂直中央揃え"
                  >
                    <AlignCenterVertical size={16} />
                  </button>
                </Tooltip>
                <Tooltip label="画面中央">
                  <button
                    type="button"
                    onClick={centerAlignDraftBoth}
                    disabled={!baseState.imageData}
                    style={!baseState.imageData ? { ...iconBtnStyle, opacity: 0.35, pointerEvents: "none" } : iconBtnStyle}
                    aria-label="画面中央"
                  >
                    <AlignCenter size={16} />
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        )}
      </div>

      {/* ===== Main body: left toolbar + canvas + right panel ===== */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Left vertical toolbar */}
        <div style={leftToolbarStyle}>
          <Tooltip label="色変更">
            <button
              type="button"
              aria-pressed={mode === "color" ? "true" : "false"}
              onClick={() => setMode("color")}
              style={mode === "color" ? leftToolBtnActiveStyle : leftToolBtnStyle}
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
              style={mode === "transparent" ? leftToolBtnActiveStyle : leftToolBtnStyle}
              aria-label="透過"
            >
              <Eraser size={18} />
            </button>
          </Tooltip>
          <Tooltip label="スポイト (I)">
            <button
              type="button"
              aria-pressed={mode === "eyedropper" ? "true" : "false"}
              onClick={() => setMode("eyedropper")}
              style={mode === "eyedropper" ? leftToolBtnActiveStyle : leftToolBtnStyle}
              aria-label="スポイト"
            >
              <Pipette size={18} />
            </button>
          </Tooltip>
          <Tooltip label="同色一括 (R)">
            <button
              type="button"
              aria-pressed={mode === "replace-all" ? "true" : "false"}
              onClick={() => setMode("replace-all")}
              style={mode === "replace-all" ? leftToolBtnActiveStyle : leftToolBtnStyle}
              aria-label="同色一括"
            >
              <Replace size={18} />
            </button>
          </Tooltip>
          <Tooltip label="ブラシ (B)">
            <button
              type="button"
              aria-pressed={mode === "brush" ? "true" : "false"}
              onClick={() => setMode("brush")}
              style={mode === "brush" ? leftToolBtnActiveStyle : leftToolBtnStyle}
              aria-label="ブラシ"
            >
              <Paintbrush size={18} />
            </button>
          </Tooltip>
          <Tooltip label="テキスト (T)">
            <button
              type="button"
              aria-pressed={mode === "text" ? "true" : "false"}
              onClick={() => setMode("text")}
              style={mode === "text" ? leftToolBtnActiveStyle : leftToolBtnStyle}
              aria-label="テキスト"
            >
              <Type size={18} />
            </button>
          </Tooltip>
          <Tooltip label="シェイプ (U)">
            <button
              type="button"
              aria-pressed={mode === "shape" ? "true" : "false"}
              onClick={() => setMode("shape")}
              style={mode === "shape" ? leftToolBtnActiveStyle : leftToolBtnStyle}
              aria-label="シェイプ"
            >
              <Square size={18} />
            </button>
          </Tooltip>
          <Tooltip label="ヘルプ (右クリックでも開けます)">
            <button
              type="button"
              onClick={() => setShortcutPos({
                x: Math.max(8, window.innerWidth / 2 - 130),
                y: Math.max(8, window.innerHeight / 2 - 120),
              })}
              style={{ ...leftToolBtnStyle, marginTop: "auto" }}
              aria-label="キーボードショートカット一覧を開く"
            >
              <HelpCircle size={18} />
            </button>
          </Tooltip>
        </div>

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
                transformOrigin: "top left",
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
                onMouseDown={(e) => { handleBrushMouseDown(e); handleShapeMouseDown(e); }}
                onMouseMove={(e) => { handleCanvasMouseMove(e); handleBrushMouseMove(e); handleShapeMouseMove(e); }}
                onMouseUp={() => { handleBrushMouseUp(); handleShapeMouseUp(); }}
                onMouseLeave={() => { handleCanvasMouseLeave(); handleBrushMouseUp(); handleShapeMouseUp(); }}
                style={{ cursor: canvasCursor, display: "block" } as React.CSSProperties}
              />
            </div>
          )}

          {/* S5-1: Text draft input overlay */}
          {textDraft !== null && baseState.imageData && (
            <div
              style={{
                position: "absolute",
                left: zoom.offsetX + textDraft.x * zoom.scale,
                top: zoom.offsetY + textDraft.y * zoom.scale,
                zIndex: 500,
                pointerEvents: "auto",
              }}
            >
              <input
                ref={textInputRef}
                type="text"
                value={textDraft.value}
                onChange={(e) => setTextDraft((d) => d ? { ...d, value: e.target.value } : null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (textDraft) commitTextDraft(textDraft);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setTextDraft(null);
                  }
                }}
                placeholder="テキストを入力してEnter"
                style={{
                  fontSize: Math.max(10, textFontSize * zoom.scale),
                  fontFamily: textFontFamily,
                  color: selectedColor,
                  background: "rgba(0,0,0,0.55)",
                  border: `1px dashed ${T.color.accent}`,
                  borderRadius: T.radius.sm,
                  padding: "2px 4px",
                  outline: "none",
                  minWidth: 120,
                  caretColor: T.color.accent,
                }}
              />
            </div>
          )}

          {/* Canvas status overlay (bottom-left) */}
          {baseState.imageData && hoverInfo && (
            <div style={statusBarStyle}>
              <span style={statusModeLabelStyle}>[{modeLabel}]</span>
              {hoverInfo}
            </div>
          )}

          {/* Zoom indicator (bottom-right) */}
          {baseState.imageData && (
            <div style={zoomIndicatorStyle}>
              {zoomPercent}%
            </div>
          )}
        </div>

        {/* Right panel */}
        {(showPalette || showMapping) && (
          <div style={rightPanelStyle}>
            {/* Panel toggle tabs */}
            <div style={rightPanelHeaderRowStyle}>
              <button
                type="button"
                onClick={() => setShowPalette((v) => !v)}
                style={showPalette ? panelTabBtnActiveStyle : panelTabBtnStyle}
              >
                パレット
              </button>
              <button
                type="button"
                onClick={() => setShowMapping((v) => !v)}
                style={showMapping ? panelTabBtnActiveStyle : panelTabBtnStyle}
              >
                ログ
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {/* Main palette colors */}
              {showPalette && palette.length > 0 && (
                <div style={rightPanelSectionStyle}>
                  <div style={rightPanelSectionHeaderStyle}>主要色</div>
                  <div style={swatchGridStyle}>
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
                </div>
              )}

              {/* Recent colors */}
              {showPalette && recentColors.length > 0 && (
                <div style={rightPanelSectionStyle}>
                  <div style={rightPanelSectionHeaderStyle}>最近</div>
                  <div style={swatchGridStyle}>
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
                </div>
              )}

              {/* Brand color swatches */}
              {showPalette && brandSwatches.length > 0 && (
                <div style={rightPanelSectionStyle}>
                  <div style={rightPanelSectionHeaderStyle}>ブランド</div>
                  <div style={swatchGridStyle}>
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
                </div>
              )}

              {/* S5-2: Palette sets */}
              {showPalette && (
                <div style={rightPanelSectionStyle}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: T.space.xs }}>
                    <div style={rightPanelSectionHeaderStyle}>パレットセット</div>
                    <button
                      type="button"
                      onClick={handleAddPaletteSet}
                      style={{ ...btnStyle, padding: "1px 6px", fontSize: T.font.badge }}
                      title="新しいパレットを追加"
                    >
                      + 新しいパレット
                    </button>
                  </div>
                  {paletteSets.length === 0 && (
                    <div style={{ color: T.color.textDim, fontSize: T.font.badge }}>パレットがありません</div>
                  )}
                  {paletteSets.map((ps) => (
                    <div key={ps.id} style={{ marginBottom: T.space.xs }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                        <button
                          type="button"
                          onClick={() => setActivePaletteSetId(activePaletteSetId === ps.id ? null : ps.id)}
                          style={{
                            flex: 1,
                            textAlign: "left",
                            background: activePaletteSetId === ps.id ? T.color.bgElevated : "transparent",
                            color: activePaletteSetId === ps.id ? T.color.textPrimary : T.color.textMuted,
                            border: `1px solid ${activePaletteSetId === ps.id ? T.color.accent : T.color.border}`,
                            borderRadius: T.radius.sm,
                            padding: "2px 6px",
                            fontSize: T.font.badge,
                            cursor: "pointer",
                            fontFamily: T.font.family,
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                          }}
                          title={ps.name}
                        >
                          {ps.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePaletteSet(ps.id)}
                          style={sidebarRemoveBtnStyle}
                          title="パレットを削除"
                        >
                          x
                        </button>
                      </div>
                      {activePaletteSetId === ps.id && (
                        <div>
                          <div style={{ ...swatchGridStyle, marginBottom: 4 }}>
                            {ps.colors.map((hex) => (
                              <div key={hex} style={{ position: "relative", display: "inline-flex" }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedColor(hex);
                                    if (mode !== "color" && mode !== "replace-all" && mode !== "text" && mode !== "shape") setMode("color");
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
                                  onClick={() => handleRemoveColorFromPaletteSet(ps.id, hex)}
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
                          <button
                            type="button"
                            onClick={() => handleAddColorToPaletteSet(ps.id)}
                            style={{ ...btnStyle, padding: "1px 6px", fontSize: T.font.badge, width: "100%" }}
                            title={`現在の色 ${selectedColor.toUpperCase()} をパレットに追加`}
                          >
                            + 現在の色を追加
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Edit log */}
              {showMapping && mappingEntries.length > 0 && (
                <div style={rightPanelSectionStyle}>
                  <div style={rightPanelSectionHeaderStyle}>
                    編集ログ ({mappingEntries.length})
                  </div>
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
              )}
            </div>
          </div>
        )}

        {/* Right panel collapsed — show reopen buttons */}
        {!showPalette && !showMapping && (
          <div style={rightPanelCollapsedStyle}>
            <button
              type="button"
              onClick={() => setShowPalette(true)}
              style={panelTabBtnStyle}
              title="パレットを表示"
            >
              P
            </button>
            <button
              type="button"
              onClick={() => setShowMapping(true)}
              style={panelTabBtnStyle}
              title="ログを表示"
            >
              L
            </button>
          </div>
        )}
      </div>

      {/* ===== Status bar (bottom, full-width) ===== */}
      <div style={bottomStatusBarStyle}>
        <span style={statusModeLabelStyle}>[{modeLabel}]</span>
        <span>{hoverInfo ?? status}</span>
        {baseState.imageData && (
          <span style={{ marginLeft: "auto", color: T.color.textDim }}>{zoomPercent}%</span>
        )}
      </div>

      {/* Issue #5: Autosave restore modal */}
      {showRestoreModal && (
        <div style={restoreModalOverlayStyle}>
          <div style={restoreModalBoxStyle}>
            <p style={restoreModalTextStyle}>
              前回の編集データが見つかりました。復元しますか？
            </p>
            <p style={{ ...restoreModalTextStyle, fontSize: 11, color: "#aaa", margin: "0 0 16px" }}>
              ※ リージョンと設定のみ復元されます。元画像は復元後に再読み込みしてください。
            </p>
            <div style={restoreModalActionsStyle}>
              <button
                type="button"
                onClick={() => {
                  autoSave.clearAutoSave();
                  setShowRestoreModal(false);
                }}
                style={btnSubtleStyle}
              >
                破棄
              </button>
              <button
                type="button"
                onClick={handleRestoreAutoSave}
                style={btnAccentStyle}
              >
                復元する
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Issue #6: Export modal */}
      {exportModalOpen && baseState.imageData && (
        <ExportModal
          naturalWidth={baseState.naturalWidth}
          naturalHeight={baseState.naturalHeight}
          onExport={handleExport}
          onClose={() => setExportModalOpen(false)}
        />
      )}

      {/* Issue #9: Canvas size modal */}
      {canvasSizeModalOpen && baseState.imageData && (
        <CanvasSizeModal
          currentWidth={baseState.naturalWidth}
          currentHeight={baseState.naturalHeight}
          onApply={handleCanvasSizeApply}
          onClose={() => setCanvasSizeModalOpen(false)}
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
  pointerEvents: "auto",
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

// Mapping sidebar rows (used in right panel)
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

// S4a: New layout styles
const leftToolbarStyle: React.CSSProperties = {
  width: 48,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: T.space.xs,
  padding: `${T.space.sm}px 0`,
  background: T.color.bgPanel,
  borderRight: `1px solid ${T.color.border}`,
  boxShadow: T.shadow.panel,
};

const leftToolBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  padding: 0,
  background: "transparent",
  color: T.color.textMuted,
  border: "none",
  borderRadius: T.radius.md,
  cursor: "pointer",
  transition: "background 120ms, color 120ms",
  flexShrink: 0,
};

const leftToolBtnActiveStyle: React.CSSProperties = {
  ...leftToolBtnStyle,
  background: T.color.accent,
  color: "#fff",
  boxShadow: "inset 0 1px 3px rgba(0,0,0,0.35)",
};

const rightPanelStyle: React.CSSProperties = {
  width: 200,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  background: T.color.bgPanel,
  borderLeft: `1px solid ${T.color.border}`,
  boxShadow: T.shadow.panel,
  overflow: "hidden",
};

const rightPanelCollapsedStyle: React.CSSProperties = {
  width: 32,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: T.space.xs,
  padding: `${T.space.sm}px 0`,
  background: T.color.bgPanel,
  borderLeft: `1px solid ${T.color.border}`,
};

const rightPanelHeaderRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 0,
  borderBottom: `1px solid ${T.color.border}`,
  flexShrink: 0,
};

const panelTabBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "5px 4px",
  background: "transparent",
  color: T.color.textMuted,
  border: "none",
  borderBottom: `2px solid transparent`,
  cursor: "pointer",
  fontSize: T.font.label,
  fontFamily: T.font.family,
  transition: "color 120ms",
};

const panelTabBtnActiveStyle: React.CSSProperties = {
  ...panelTabBtnStyle,
  color: T.color.textPrimary,
  borderBottom: `2px solid ${T.color.accent}`,
};

const rightPanelSectionStyle: React.CSSProperties = {
  padding: `${T.space.xs}px ${T.space.sm}px`,
  borderBottom: `1px solid ${T.color.border}`,
};

const rightPanelSectionHeaderStyle: React.CSSProperties = {
  fontSize: T.font.badge,
  color: T.color.textDim,
  fontFamily: T.font.family,
  marginBottom: T.space.xs,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const swatchGridStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: T.space.xs,
};

// Issue #5: Autosave restore modal styles
const restoreModalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const restoreModalBoxStyle: React.CSSProperties = {
  background: T.color.bgPanel,
  border: `1px solid ${T.color.borderMid}`,
  borderRadius: T.radius.lg,
  padding: `${T.space.xl}px`,
  maxWidth: 360,
  width: "90%",
  boxShadow: T.shadow.elevated,
  fontFamily: T.font.family,
  color: T.color.textPrimary,
};

const restoreModalTextStyle: React.CSSProperties = {
  margin: "0 0 16px",
  fontSize: T.font.body,
};

const restoreModalActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: T.space.sm,
  justifyContent: "flex-end",
};

const btnAccentStyle: React.CSSProperties = {
  padding: "3px 10px",
  background: T.color.accent,
  color: "#fff",
  border: `1px solid ${T.color.accent}`,
  borderRadius: T.radius.sm,
  cursor: "pointer",
  fontSize: T.font.label,
  fontFamily: T.font.family,
  transition: "background 120ms",
};

const bottomStatusBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: T.space.sm,
  padding: `3px ${T.space.md}px`,
  background: T.color.bgPanel,
  borderTop: `1px solid ${T.color.border}`,
  fontSize: T.font.label,
  color: T.color.textPrimary,
  fontFamily: T.font.family,
  flexShrink: 0,
};
