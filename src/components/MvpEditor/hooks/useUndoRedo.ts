import { useCallback, useState } from "react";

const HISTORY_LIMIT = 30;

export interface UndoRedoState<T> {
  history: T[];
  index: number;
}

export interface UseUndoRedoReturn<T> {
  current: T;
  canUndo: boolean;
  canRedo: boolean;
  push: (next: T) => void;
  undo: () => void;
  redo: () => void;
  reset: (value: T) => void;
}

export function useUndoRedo<T>(initial: T): UseUndoRedoReturn<T> {
  const [state, setState] = useState<UndoRedoState<T>>({
    history: [initial],
    index: 0,
  });

  const current = state.history[state.index];
  const canUndo = state.index > 0;
  const canRedo = state.index < state.history.length - 1;

  const push = useCallback((next: T) => {
    setState((prev) => {
      const truncated = prev.history.slice(0, prev.index + 1);
      const newHistory = [...truncated, next];
      const sliced =
        newHistory.length > HISTORY_LIMIT
          ? newHistory.slice(newHistory.length - HISTORY_LIMIT)
          : newHistory;
      return { history: sliced, index: sliced.length - 1 };
    });
  }, []);

  const undo = useCallback(() => {
    setState((prev) =>
      prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev
    );
  }, []);

  const redo = useCallback(() => {
    setState((prev) =>
      prev.index < prev.history.length - 1
        ? { ...prev, index: prev.index + 1 }
        : prev
    );
  }, []);

  const reset = useCallback((value: T) => {
    setState({ history: [value], index: 0 });
  }, []);

  return { current, canUndo, canRedo, push, undo, redo, reset };
}
