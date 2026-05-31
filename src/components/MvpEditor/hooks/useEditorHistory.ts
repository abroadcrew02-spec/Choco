import { useRef, useCallback, useState } from "react";
import { HISTORY_LIMIT } from "./useUndoRedo";
import type { PaintRegion } from "../lib/imageProcessing";

/**
 * Snapshot type for one atomic history entry.
 * bakeLayer is stored as a copied ImageData (null = cleared/unused).
 */
export interface EditorSnapshot {
  regions: PaintRegion[];
  bakeLayer: ImageData | null;
}

export interface EditorHistoryState {
  history: EditorSnapshot[];
  index: number;
}

/**
 * Manages regions + bakeLayer as a single atomic undo/redo unit.
 *
 * Stores both regions and a bakeLayer snapshot together so push/undo/redo
 * are always in sync — eliminating the dual-history desync of Issue #4.
 *
 * bakeLayerRef is the live mutable ImageData used for brush stroke accumulation.
 * Consumers mutate it directly for performance; call push() to commit.
 */
export interface UseEditorHistoryReturn {
  /** Live mutable bake layer ref — mutate directly for brush strokes */
  bakeLayerRef: React.MutableRefObject<ImageData | null>;
  /** Current regions from undo/redo state */
  readonly regions: PaintRegion[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /**
   * Atomically pushes a new entry into history.
   * bakeLayer snapshot is deep-copied to avoid aliasing.
   */
  push: (regions: PaintRegion[], bakeLayer: ImageData | null) => void;
  /** Undoes one step, restores bakeLayerRef from snapshot */
  undo: () => void;
  /** Redoes one step, restores bakeLayerRef from snapshot */
  redo: () => void;
  /** Resets history to initial empty state */
  reset: () => void;
}

function copyImageData(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

const INITIAL_SNAPSHOT: EditorSnapshot = { regions: [], bakeLayer: null };

export function useEditorHistory(): UseEditorHistoryReturn {
  const [state, setState] = useState<EditorHistoryState>({
    history: [INITIAL_SNAPSHOT],
    index: 0,
  });

  const bakeLayerRef = useRef<ImageData | null>(null);

  const current = state.history[state.index];

  const push = useCallback(
    (regions: PaintRegion[], bakeLayer: ImageData | null) => {
      const snapshot: EditorSnapshot = {
        regions,
        bakeLayer: bakeLayer ? copyImageData(bakeLayer) : null,
      };
      setState((prev) => {
        const truncated = prev.history.slice(0, prev.index + 1);
        const next = [...truncated, snapshot];
        const sliced =
          next.length > HISTORY_LIMIT
            ? next.slice(next.length - HISTORY_LIMIT)
            : next;
        return { history: sliced, index: sliced.length - 1 };
      });
    },
    []
  );

  const undo = useCallback(() => {
    setState((prev) => {
      if (prev.index <= 0) return prev;
      const nextIndex = prev.index - 1;
      const snapshot = prev.history[nextIndex];
      // Restore bakeLayerRef synchronously within the setState callback
      // (safe: ref mutation does not trigger re-render)
      bakeLayerRef.current = snapshot.bakeLayer
        ? copyImageData(snapshot.bakeLayer)
        : null;
      return { ...prev, index: nextIndex };
    });
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      if (prev.index >= prev.history.length - 1) return prev;
      const nextIndex = prev.index + 1;
      const snapshot = prev.history[nextIndex];
      bakeLayerRef.current = snapshot.bakeLayer
        ? copyImageData(snapshot.bakeLayer)
        : null;
      return { ...prev, index: nextIndex };
    });
  }, []);

  const reset = useCallback(() => {
    bakeLayerRef.current = null;
    setState({ history: [INITIAL_SNAPSHOT], index: 0 });
  }, []);

  return {
    bakeLayerRef,
    regions: current.regions,
    canUndo: state.index > 0,
    canRedo: state.index < state.history.length - 1,
    push,
    undo,
    redo,
    reset,
  };
}

// Re-export HISTORY_LIMIT so callers have a single import point.
export { HISTORY_LIMIT };
