import { expose } from "comlink";
import {
  marchingSquaresPath,
  buildSvg,
  type PaintRegion,
} from "../components/MvpEditor/lib/imageProcessing";

/**
 * Image-processing Worker API.
 *
 * Offloads CPU-heavy path generation (marching squares, SVG building) from the
 * main thread so that the UI remains responsive during large-image exports.
 *
 * Phase 1 (Issue #54-A): marchingSquaresPath + buildSvg.
 * Additional functions (floodFill, smoothReplace, …) are candidates for
 * Phase 2 — tracked in a follow-up Issue.
 */
export interface ImageProcessingApi {
  /**
   * Builds an SVG path string from a set of pixel coordinates using marching
   * squares boundary tracing. Runs off the main thread.
   *
   * @param pixels    - Selected pixel coordinates
   * @param fallback  - Set to true in the returned object when the bounding-box
   *                    fallback was triggered (too many pixels).
   */
  marchingSquaresPath(pixels: { x: number; y: number }[]): {
    path: string;
    usedFallback: boolean;
  };

  /**
   * Builds a complete SVG document string from the given image and paint
   * regions. The base image is embedded as a PNG data URL. Runs off the
   * main thread.
   *
   * Note: ImageData cannot be transferred to a Worker directly in all
   * environments. Callers must pass raw pixel bytes + dimensions separately.
   * The pixel buffer is passed as Uint8Array to avoid SharedArrayBuffer type
   * conflicts; the Worker reconstructs an ImageData internally.
   *
   * @param rgba      - Raw RGBA pixel buffer (Uint8Array)
   * @param width     - Image width in pixels
   * @param height    - Image height in pixels
   * @param regions   - Paint regions to composite into the SVG
   * @returns Object containing the SVG string and whether the fallback fired.
   */
  buildSvg(
    rgba: Uint8Array,
    width: number,
    height: number,
    regions: PaintRegion[]
  ): { svg: string; usedFallback: boolean };
}

const api: ImageProcessingApi = {
  marchingSquaresPath(pixels) {
    let usedFallback = false;
    const path = marchingSquaresPath(pixels, () => {
      usedFallback = true;
    });
    return { path, usedFallback };
  },

  buildSvg(rgba, width, height, regions) {
    // Reconstruct ImageData inside the Worker from the transferred buffer.
    // Uint8Array is used in the API signature to sidestep SharedArrayBuffer
    // type conflicts; we copy into a fresh Uint8ClampedArray<ArrayBuffer> to
    // satisfy the ImageData constructor's ImageDataArray constraint.
    // Values are already in [0, 255] so no clamping occurs.
    // new Uint8ClampedArray(uint8Array) produces a Uint8ClampedArray<ArrayBuffer>
    // (plain copy) satisfying the ImageData constructor's ImageDataArray constraint.
    const clamped = new Uint8ClampedArray(rgba);
    const imageData = new ImageData(clamped, width, height);
    let usedFallback = false;
    const svg = buildSvg(imageData, regions, width, height, () => {
      usedFallback = true;
    });
    return { svg, usedFallback };
  },
};

expose(api);
