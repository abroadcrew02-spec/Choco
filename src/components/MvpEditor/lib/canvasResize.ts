import type { PaintRegion } from "../MvpEditor";

/**
 * Anchor position for canvas resize operations.
 * Determines how the existing content is positioned within the new canvas.
 */
export type AnchorPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/**
 * Canvas resize mode.
 * - "crop": content is placed at the anchor position; pixels outside the new bounds are discarded.
 * - "scale": content is scaled (drawImage) to fit the new canvas dimensions.
 */
export type ResizeMode = "crop" | "scale";

/**
 * Calculates the pixel offset (srcOffsetX, srcOffsetY) to apply to source coordinates
 * when placing an old canvas of size (oldW × oldH) into a new canvas of size (newW × newH)
 * at the given anchor position.
 *
 * Returns {offsetX, offsetY} where:
 *   newX = srcX + offsetX
 *   newY = srcY + offsetY
 *
 * Exported for unit testing.
 */
export function calcCropOffset(
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
  anchor: AnchorPosition
): { offsetX: number; offsetY: number } {
  let offsetX: number;
  let offsetY: number;

  const col = anchor.split("-")[1] as "left" | "center" | "right";
  const row = anchor.split("-")[0] as "top" | "middle" | "bottom";

  switch (col) {
    case "left":
      offsetX = 0;
      break;
    case "center":
      offsetX = Math.round((newW - oldW) / 2);
      break;
    case "right":
      offsetX = newW - oldW;
      break;
    default:
      offsetX = 0;
  }

  switch (row) {
    case "top":
      offsetY = 0;
      break;
    case "middle":
      offsetY = Math.round((newH - oldH) / 2);
      break;
    case "bottom":
      offsetY = newH - oldH;
      break;
    default:
      offsetY = 0;
  }

  return { offsetX, offsetY };
}

/**
 * Crop-resizes an ImageData to newW × newH.
 * The old content is placed according to the anchor position.
 * Pixels outside the new bounds are transparent black.
 *
 * Exported for unit testing.
 */
export function cropImageData(
  src: ImageData,
  newW: number,
  newH: number,
  anchor: AnchorPosition
): ImageData {
  const { offsetX, offsetY } = calcCropOffset(src.width, src.height, newW, newH, anchor);
  const dstData = new Uint8ClampedArray(newW * newH * 4); // initialized to 0 (transparent)
  const srcData = src.data;

  for (let sy = 0; sy < src.height; sy++) {
    const dy = sy + offsetY;
    if (dy < 0 || dy >= newH) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const dx = sx + offsetX;
      if (dx < 0 || dx >= newW) continue;
      const sk = (sy * src.width + sx) * 4;
      const dk = (dy * newW + dx) * 4;
      dstData[dk] = srcData[sk];
      dstData[dk + 1] = srcData[sk + 1];
      dstData[dk + 2] = srcData[sk + 2];
      dstData[dk + 3] = srcData[sk + 3];
    }
  }

  return new ImageData(dstData, newW, newH);
}

/**
 * Scale-resizes an ImageData to newW × newH using nearest-neighbor interpolation.
 * The entire source is scaled to fill the new dimensions.
 *
 * Exported for unit testing.
 */
export function scaleImageData(
  src: ImageData,
  newW: number,
  newH: number
): ImageData {
  const dstData = new Uint8ClampedArray(newW * newH * 4);
  const srcData = src.data;
  const scaleX = src.width / newW;
  const scaleY = src.height / newH;

  for (let dy = 0; dy < newH; dy++) {
    const sy = Math.min(Math.floor(dy * scaleY), src.height - 1);
    for (let dx = 0; dx < newW; dx++) {
      const sx = Math.min(Math.floor(dx * scaleX), src.width - 1);
      const sk = (sy * src.width + sx) * 4;
      const dk = (dy * newW + dx) * 4;
      dstData[dk] = srcData[sk];
      dstData[dk + 1] = srcData[sk + 1];
      dstData[dk + 2] = srcData[sk + 2];
      dstData[dk + 3] = srcData[sk + 3];
    }
  }

  return new ImageData(dstData, newW, newH);
}

/**
 * Transforms a PaintRegion's pixel coordinates when cropping.
 * Pixels that fall outside [0, newW) × [0, newH) are discarded.
 *
 * Exported for unit testing.
 */
export function cropRegion(
  region: PaintRegion,
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
  anchor: AnchorPosition
): PaintRegion {
  const { offsetX, offsetY } = calcCropOffset(oldW, oldH, newW, newH, anchor);
  const newPixels = region.pixels
    .map(({ x, y }) => ({ x: x + offsetX, y: y + offsetY }))
    .filter(({ x, y }) => x >= 0 && x < newW && y >= 0 && y < newH);

  return { ...region, pixels: newPixels };
}

/**
 * Transforms a PaintRegion's pixel coordinates when scaling.
 * Coordinates are mapped proportionally; duplicates may arise for small targets.
 * A Set-based dedup is applied.
 *
 * Exported for unit testing.
 */
export function scaleRegion(
  region: PaintRegion,
  oldW: number,
  oldH: number,
  newW: number,
  newH: number
): PaintRegion {
  const scaleX = newW / oldW;
  const scaleY = newH / oldH;
  const seen = new Set<number>();
  const newPixels: { x: number; y: number }[] = [];

  for (const { x, y } of region.pixels) {
    const nx = Math.min(Math.floor(x * scaleX), newW - 1);
    const ny = Math.min(Math.floor(y * scaleY), newH - 1);
    const key = ny * newW + nx;
    if (!seen.has(key)) {
      seen.add(key);
      newPixels.push({ x: nx, y: ny });
    }
  }

  return { ...region, pixels: newPixels };
}
