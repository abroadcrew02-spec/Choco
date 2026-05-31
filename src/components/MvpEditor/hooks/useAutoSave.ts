/**
 * useAutoSave.ts
 *
 * React hook that auto-saves the editor project state at a 5-minute interval
 * and checks for a saved session on mount.
 *
 * Storage strategy (IndexedDB-first with localStorage fallback):
 *   Primary:  IndexedDB ("choco-db" / "autosave" / key "project")
 *             Stores the FULL project including image data (no quota limit).
 *   Fallback: localStorage key "choco:autosave"
 *             Stores ChocoProjectLite (imageOmitted: true) when IDB fails.
 *
 * The IDB path stores a full ChocoProject so that image data survives a
 * browser restart without the user having to re-open the original file.
 * If IndexedDB is unavailable (private browsing, jsdom, etc.) the hook
 * silently falls back to the pre-existing localStorage-lite path.
 */

import { useEffect, useRef, useCallback } from "react";
import {
  serializeProject,
  deserializeProject,
  deserializeProjectLite,
  type ProjectState,
  type ProjectStateLite,
} from "../lib/projectIO";
import {
  saveProjectToIDB,
  loadProjectFromIDB,
  clearProjectFromIDB,
  isIDBAvailable,
} from "../lib/projectStorage";
import { getProjectSerializerWorker } from "../../../worker/projectSerializerWorker";
import type { SerializableProjectState } from "../../../worker/projectSerializer.worker";

export const AUTOSAVE_KEY = "choco:autosave";
const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface UseAutoSaveOptions {
  /** Called every time a successful autosave completes. */
  onSave?: () => void;
  /** Called when autosave throws an error (e.g. quota exceeded). */
  onError?: (err: unknown) => void;
}

export interface AutoSaveResult {
  /** Clears the autosave from both IndexedDB and localStorage. */
  clearAutoSave: () => void;
  /** Returns true if there is an autosave entry (checks IDB first, then localStorage). */
  hasAutoSave: () => boolean;
  /**
   * Loads and deserializes the autosave entry.
   *
   * IDB path: returns ProjectState (full, with image) if available.
   * localStorage fallback path: returns ProjectStateLite (imageData: null).
   * Returns null if no autosave exists or deserialization fails.
   */
  loadAutoSave: () => Promise<ProjectState | ProjectStateLite | null>;
  /** Manually triggers an immediate save (in addition to the interval). */
  saveNow: () => void;
}

/**
 * useAutoSave
 *
 * @param getState  - Function that returns the current ProjectState to save.
 *                    Must be stable (wrapped in useCallback) to avoid re-registering
 *                    the interval on every render.
 * @param enabled   - Whether autosave is active. Pass false when no image is loaded.
 * @param options   - Optional callbacks for save completion / errors.
 */
export function useAutoSave(
  getState: () => ProjectState | null,
  enabled: boolean,
  options: UseAutoSaveOptions = {}
): AutoSaveResult {
  const onSaveRef = useRef(options.onSave);
  const onErrorRef = useRef(options.onError);
  const getStateRef = useRef(getState);

  // Keep refs in sync without re-registering the interval
  useEffect(() => {
    onSaveRef.current = options.onSave;
  }, [options.onSave]);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  useEffect(() => {
    getStateRef.current = getState;
  }, [getState]);

  // ---------------------------------------------------------------------------
  // Core save logic
  // ---------------------------------------------------------------------------

  /**
   * Attempts an IndexedDB save with full image data.
   * Serialization is offloaded to the projectSerializer Worker to avoid
   * blocking the main thread on large images (Issue #62).
   * Falls back to synchronous serialization if the Worker fails, then
   * falls back to localStorage lite format if IDB itself fails.
   */
  const performSave = useCallback(() => {
    const state = getStateRef.current();
    if (!state) return;

    if (isIDBAvailable()) {
      // Build the serializable wire format (no ImageData objects)
      const serializableState: SerializableProjectState = {
        imageRgba: new Uint8Array(state.imageData.data.buffer),
        imageWidth: state.imageData.width,
        imageHeight: state.imageData.height,
        naturalWidth: state.naturalWidth,
        naturalHeight: state.naturalHeight,
        regions: state.regions,
        bakeLayerRgba: state.bakeLayer ? new Uint8Array(state.bakeLayer.data.buffer) : null,
        bakeLayerWidth: state.bakeLayer ? state.bakeLayer.width : null,
        bakeLayerHeight: state.bakeLayer ? state.bakeLayer.height : null,
        selectedColor: state.selectedColor,
        tolerance: state.tolerance,
      };

      // IDB path: serialize in Worker (non-blocking), then save to IDB
      getProjectSerializerWorker()
        .serializeProjectInWorker(serializableState)
        .then((project) => saveProjectToIDB(project as ReturnType<typeof serializeProject>))
        .then(() => {
          onSaveRef.current?.();
        })
        .catch((workerOrIdbErr: unknown) => {
          console.warn(
            "[useAutoSave] Worker/IDB save failed, falling back to sync serialize + localStorage:",
            workerOrIdbErr
          );
          // Sync fallback: serializeProject on main thread, then IDB or localStorage
          try {
            const project = serializeProject(state);
            saveProjectToIDB(project)
              .then(() => { onSaveRef.current?.(); })
              .catch(() => { _saveToLocalStorage(state); });
          } catch {
            _saveToLocalStorage(state);
          }
        });
    } else {
      // IDB unavailable: localStorage-only path
      _saveToLocalStorage(state);
    }
  }, []);

  /** localStorage fallback — lite format (imageOmitted: true). */
  function _saveToLocalStorage(state: ProjectState): void {
    try {
      const project = serializeProject(state, { includeImage: false });
      const json = JSON.stringify(project);
      localStorage.setItem(AUTOSAVE_KEY, json);
      onSaveRef.current?.();
    } catch (err) {
      console.warn("[useAutoSave] Failed to autosave to localStorage:", err);
      onErrorRef.current?.(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Interval
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(performSave, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, performSave]);

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const clearAutoSave = useCallback(() => {
    // Clear IDB (async, fire-and-forget)
    if (isIDBAvailable()) {
      clearProjectFromIDB().catch((err: unknown) => {
        console.warn("[useAutoSave] Failed to clear IDB autosave:", err);
      });
    }
    // Always clear localStorage fallback entry too
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      // ignore
    }
  }, []);

  /**
   * Synchronous presence check.
   * Returns true if localStorage has an entry (fast, synchronous).
   * IDB presence requires async; for sync API we use localStorage as sentinel.
   * Note: IDB may have data even if localStorage is empty (normal after IDB save).
   * This function errs on the side of "maybe has autosave" — callers should
   * use loadAutoSave() to confirm.
   */
  const hasAutoSave = useCallback((): boolean => {
    // Check localStorage (synchronous)
    try {
      if (localStorage.getItem(AUTOSAVE_KEY) !== null) return true;
    } catch {
      // ignore
    }
    // For IDB we cannot check synchronously; assume available if IDB is reachable.
    // The actual data presence is confirmed by loadAutoSave().
    return isIDBAvailable();
  }, []);

  const loadAutoSave = useCallback(async (): Promise<ProjectState | ProjectStateLite | null> => {
    // Try IDB first
    if (isIDBAvailable()) {
      try {
        const raw = await loadProjectFromIDB();
        if (raw !== null) {
          // Full project with image data
          try {
            const state = await deserializeProject(raw);
            return state;
          } catch (deserErr) {
            console.warn("[useAutoSave] IDB data deserialization failed, trying lite:", deserErr);
            // May be an old lite format stored in IDB — try lite path
            const lite = deserializeProjectLite(raw);
            if (lite !== null) return lite;
          }
        }
      } catch (idbErr) {
        console.warn("[useAutoSave] IDB load failed, falling back to localStorage:", idbErr);
      }
    }

    // localStorage fallback
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      return deserializeProjectLite(parsed);
    } catch (err) {
      console.warn("[useAutoSave] Failed to load autosave from localStorage:", err);
      return null;
    }
  }, []);

  const saveNow = useCallback(() => {
    if (enabled) performSave();
  }, [enabled, performSave]);

  return { clearAutoSave, hasAutoSave, loadAutoSave, saveNow };
}
