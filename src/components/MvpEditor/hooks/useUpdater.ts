import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface UpdaterState {
  phase: UpdaterPhase;
  /** Version string of the available update, set when phase === "available" or later */
  availableVersion: string | null;
  /** Release notes from the update manifest */
  releaseNotes: string | null;
  /** Download progress 0-100, set during phase === "downloading" */
  downloadProgress: number;
  /** Human-readable error message, set when phase === "error" */
  errorMessage: string | null;
}

export interface UseUpdaterReturn extends UpdaterState {
  /** Dismiss the update modal without installing */
  dismiss: () => void;
  /** Start download and install */
  startInstall: () => Promise<void>;
  /** Relaunch the application after a successful install */
  doRelaunch: () => Promise<void>;
}

const INITIAL_STATE: UpdaterState = {
  phase: "idle",
  availableVersion: null,
  releaseNotes: null,
  downloadProgress: 0,
  errorMessage: null,
};

/**
 * Hook that runs a background update check on mount and exposes
 * install / dismiss controls to the caller.
 *
 * ADR-0005: dialog is false; all UI is handled by the caller.
 * Downgrade protection: if the returned version is <= the current
 * version the check() call already filters it out (allowDowngrades
 * defaults to false in tauri-plugin-updater). An additional Rust-side
 * guard is implemented in commands/update_check.rs.
 */
export function useUpdater(): UseUpdaterReturn {
  const [state, setState] = useState<UpdaterState>(INITIAL_STATE);
  const updateRef = useRef<Update | null>(null);

  const runCheck = useCallback(async () => {
    setState((prev) => ({ ...prev, phase: "checking" }));
    try {
      // allowDowngrades defaults to false, so plugin already rejects downgrades
      const update = await check();
      if (update === null) {
        setState((prev) => ({ ...prev, phase: "idle" }));
        return;
      }
      updateRef.current = update;
      setState((prev) => ({
        ...prev,
        phase: "available",
        availableVersion: update.version,
        releaseNotes: update.body ?? null,
      }));
    } catch (err) {
      // Network errors (ADR-0005 fallback: silent on check failure)
      console.warn("[updater] check failed, skipping:", err);
      setState((prev) => ({ ...prev, phase: "idle" }));
    }
  }, []);

  // Run check once on mount (background, non-blocking)
  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  const dismiss = useCallback(() => {
    setState(INITIAL_STATE);
    updateRef.current = null;
  }, []);

  const startInstall = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    setState((prev) => ({ ...prev, phase: "downloading", downloadProgress: 0 }));

    let totalBytes: number | undefined;
    let downloadedBytes = 0;

    try {
      await update.download((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes && totalBytes > 0) {
            const pct = Math.min(
              99,
              Math.round((downloadedBytes / totalBytes) * 100)
            );
            setState((prev) => ({ ...prev, downloadProgress: pct }));
          }
        } else if (event.event === "Finished") {
          setState((prev) => ({ ...prev, downloadProgress: 100 }));
        }
      });

      await update.install();

      setState((prev) => ({ ...prev, phase: "ready", downloadProgress: 100 }));
    } catch (err) {
      // ADR-0005: signature verification failure → error toast, old version retained
      const msg =
        err instanceof Error ? err.message : String(err);
      console.error("[updater] install failed:", err);
      setState((prev) => ({
        ...prev,
        phase: "error",
        errorMessage: msg,
      }));
    }
  }, []);

  const doRelaunch = useCallback(async () => {
    await relaunch();
  }, []);

  return {
    ...state,
    dismiss,
    startInstall,
    doRelaunch,
  };
}
