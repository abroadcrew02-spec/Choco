/**
 * useAutoSave.ts
 *
 * React hook that auto-saves the editor project state to localStorage
 * at a 5-minute interval and checks for a saved session on mount.
 *
 * Storage key: "choco:autosave"
 * Format: JSON-serialized ChocoProjectLite (version 1, imageOmitted: true)
 *
 * Image data is intentionally excluded from autosave to prevent localStorage
 * quota exhaustion (a full-resolution PNG can exceed the 5-10 MB quota limit).
 * Explicit .choco file saves still include the full image.
 *
 * Note: Full async migration to IndexedDB is deferred to a future issue.
 */

import { useEffect, useRef, useCallback } from "react";
import {
  serializeProject,
  deserializeProjectLite,
  type ProjectState,
  type ProjectStateLite,
} from "../lib/projectIO";

export const AUTOSAVE_KEY = "choco:autosave";
const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface UseAutoSaveOptions {
  /** Called every time a successful autosave completes. */
  onSave?: () => void;
  /** Called when autosave throws an error (e.g. quota exceeded). */
  onError?: (err: unknown) => void;
}

export interface AutoSaveResult {
  /** Clears the autosave from localStorage (called after explicit save / on discard). */
  clearAutoSave: () => void;
  /** Returns true if there is an autosave entry in localStorage. */
  hasAutoSave: () => boolean;
  /**
   * Loads and deserializes the autosave entry.
   * Returns a ProjectStateLite (imageData: null) for lite autosaves, or null
   * if no autosave exists or deserialization fails.
   */
  loadAutoSave: () => Promise<ProjectStateLite | null>;
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

  // The interval-based save — image is excluded to avoid localStorage quota issues.
  const performSave = useCallback(() => {
    const state = getStateRef.current();
    if (!state) return;
    try {
      const project = serializeProject(state, { includeImage: false });
      const json = JSON.stringify(project);
      localStorage.setItem(AUTOSAVE_KEY, json);
      onSaveRef.current?.();
    } catch (err) {
      console.warn("[useAutoSave] Failed to autosave:", err);
      onErrorRef.current?.(err);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(performSave, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, performSave]);

  const clearAutoSave = useCallback(() => {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const hasAutoSave = useCallback((): boolean => {
    try {
      return localStorage.getItem(AUTOSAVE_KEY) !== null;
    } catch {
      return false;
    }
  }, []);

  const loadAutoSave = useCallback(async (): Promise<ProjectStateLite | null> => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      return deserializeProjectLite(parsed);
    } catch (err) {
      console.warn("[useAutoSave] Failed to load autosave:", err);
      return null;
    }
  }, []);

  const saveNow = useCallback(() => {
    if (enabled) performSave();
  }, [enabled, performSave]);

  return { clearAutoSave, hasAutoSave, loadAutoSave, saveNow };
}
