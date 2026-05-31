import { wrap } from "comlink";
import type { ImageProcessingApi } from "./imageProcessing.worker";

/**
 * Lazily creates and caches a single Worker instance for image-processing
 * tasks. The Worker is shared across calls to avoid spawn overhead on each
 * export.
 *
 * The module-level singleton is intentional: Worker threads are expensive to
 * create, and a single dedicated thread is sufficient for sequential SVG
 * exports.
 *
 * Returns a comlink-wrapped proxy so callers can await worker methods like
 * ordinary async functions.
 */

let workerInstance: Worker | null = null;
let apiProxy: ReturnType<typeof wrap<ImageProcessingApi>> | null = null;

export function getImageProcessingWorker(): ReturnType<
  typeof wrap<ImageProcessingApi>
> {
  if (!apiProxy) {
    workerInstance = new Worker(
      new URL("./imageProcessing.worker.ts", import.meta.url),
      { type: "module" }
    );
    apiProxy = wrap<ImageProcessingApi>(workerInstance);
  }
  return apiProxy;
}

/**
 * Terminates the cached Worker instance. Call on app teardown or when the
 * Worker is no longer needed to free the thread resource.
 */
export function terminateImageProcessingWorker(): void {
  workerInstance?.terminate();
  workerInstance = null;
  apiProxy = null;
}
