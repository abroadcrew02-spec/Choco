// ---------------------------------------------------------------------------
// Pure image-processing utilities extracted from MvpEditor.tsx (Issue #17).
//
// This module holds side-effect-free helpers operating on ImageData, pixel
// selections, SVG path generation, and related geometry. They have no React
// or component-state dependencies and are unit-tested directly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaintRegion {
  id: string;
  pixels: { x: number; y: number }[];
  color: string;
  transparent: boolean;
}

export type ShapeKind = "rect" | "circle" | "polygon" | "star";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
export function imageDataToPngDataUrl(imageData: ImageData, scale = 1): string {
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

  const maskPath =
    transparentPixels.length > 0
      ? marchingSquaresPath(transparentPixels, onFallback)
      : "";

  const maskSection =
    maskPath.length > 0
      ? `  <mask id="transparentMask">
    <rect width="${width}" height="${height}" fill="white" />
    <path d="${maskPath}" fill="black" fill-rule="evenodd" />
  </mask>`
      : "";

  const imageElement =
    maskPath.length > 0
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
export function rewriteSvgForHighResRasterize(svgText: string): {
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
 * Builds the path for a shape (rect/circle/polygon/star) onto a 2D canvas
 * context. Assumes ctx.beginPath() has already been called. Does not apply
 * fill or stroke.
 */
export function buildShapePath(
  ctx: CanvasRenderingContext2D,
  kind: ShapeKind,
  x: number,
  y: number,
  w: number,
  h: number,
  polyVertices: number
): void {
  if (kind === "rect") {
    ctx.rect(x, y, w, h);
  } else if (kind === "circle") {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
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
  buildShapePath(ctx, kind, x, y, w, h, polyVertices);

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
 * Copies all pixel data from src into dest in-place.
 * dest and src must have the same dimensions.
 * Uses TypedArray.set() for a single bulk copy instead of a manual loop.
 */
export function copyImageDataInto(dest: ImageData, src: ImageData): void {
  dest.data.set(src.data);
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
