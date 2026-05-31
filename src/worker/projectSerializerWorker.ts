import { wrap } from "comlink";
import type { ProjectSerializerApi } from "./projectSerializer.worker";

/**
 * Lazily creates and caches a single Worker instance for project serialization.
 *
 * A module-level singleton keeps spawn overhead to a minimum; a single thread
 * is sufficient for sequential autosave operations.
 *
 * Returns a comlink-wrapped proxy so callers can await Worker methods as
 * ordinary async functions.
 */

let workerInstance: Worker | null = null;
let apiProxy: ReturnType<typeof wrap<ProjectSerializerApi>> | null = null;

export function getProjectSerializerWorker(): ReturnType<
  typeof wrap<ProjectSerializerApi>
> {
  if (!apiProxy) {
    workerInstance = new Worker(
      new URL("./projectSerializer.worker.ts", import.meta.url),
      { type: "module" }
    );
    apiProxy = wrap<ProjectSerializerApi>(workerInstance);
  }
  return apiProxy;
}

/**
 * Terminates the cached Worker instance. Call on app teardown or when the
 * Worker is no longer needed to free the thread resource.
 */
export function terminateProjectSerializerWorker(): void {
  workerInstance?.terminate();
  workerInstance = null;
  apiProxy = null;
}
