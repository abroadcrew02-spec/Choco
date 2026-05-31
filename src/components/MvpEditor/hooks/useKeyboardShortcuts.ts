import { useEffect } from "react";
import type { UseEditorHistoryReturn } from "./useEditorHistory";
import type { UseZoomPanReturn } from "./useZoomPan";
import { isInputFocused } from "../lib/imageProcessing";
import { t, type Lang } from "../lib/i18n";

export type EditorMode =
  | "color"
  | "transparent"
  | "eyedropper"
  | "replace-all"
  | "brush"
  | "text"
  | "shape";

export interface UseKeyboardShortcutsParams {
  editorHistory: UseEditorHistoryReturn;
  zoom: UseZoomPanReturn;
  containerRef: React.RefObject<HTMLDivElement>;
  naturalWidth: number;
  naturalHeight: number;
  lang: Lang;
  setMode: (mode: EditorMode) => void;
  setSpacePressed: (pressed: boolean) => void;
  setStatus: (status: string) => void;
  setTextDraft: (draft: null) => void;
  triggerRedraw: () => void;
  handleCopyToClipboard: () => void;
  handleReferencePaste: () => void;
  handleClipboardPaste: () => void;
}

/**
 * Global keyboard shortcuts for the editor canvas.
 *
 * Handles tool selection (B/I/R/T/U), undo/redo (Ctrl+Z / Ctrl+Y),
 * fit-to-container (Ctrl+0), clipboard copy/paste (Ctrl+C / Ctrl+V /
 * Ctrl+Shift+V), space-to-pan, and Escape-to-cancel.
 *
 * Bare tool shortcuts are ignored while an input element has focus;
 * modifier-based shortcuts (Ctrl/Meta) are always processed.
 *
 * Project-level shortcuts (Ctrl+S / Ctrl+O) are intentionally NOT handled
 * here — they live next to their save/load handlers to avoid forward refs.
 */
export function useKeyboardShortcuts(params: UseKeyboardShortcutsParams): void {
  const {
    editorHistory,
    zoom,
    containerRef,
    naturalWidth,
    naturalHeight,
    lang,
    setMode,
    setSpacePressed,
    setStatus,
    setTextDraft,
    triggerRedraw,
    handleCopyToClipboard,
    handleReferencePaste,
    handleClipboardPaste,
  } = params;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore bare tool shortcuts when an input element has focus.
      // Modifier-based shortcuts (Ctrl/Meta) are always processed.
      if (!e.ctrlKey && !e.metaKey && isInputFocused(e.target)) return;

      if (e.code === "Space") {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        editorHistory.undo();
        triggerRedraw();
        setStatus(t("status.undo", lang));
        return;
      }
      if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
        e.preventDefault();
        editorHistory.redo();
        triggerRedraw();
        setStatus(t("status.redo", lang));
        return;
      }
      if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        const container = containerRef.current;
        if (container && naturalWidth > 0) {
          zoom.fitToContainer(
            container.clientWidth,
            container.clientHeight,
            naturalWidth,
            naturalHeight
          );
        }
        return;
      }
      // Ctrl+C: copy composited canvas to clipboard as PNG (Issue #8)
      // Only fires when no input element is focused (text copy is handled by browser default).
      if (e.ctrlKey && e.key === "c" && !isInputFocused(e.target)) {
        e.preventDefault();
        handleCopyToClipboard();
        return;
      }
      // Ctrl+Shift+V: paste image as reference layer (Issue #24)
      if (e.ctrlKey && e.shiftKey && e.key === "V") {
        e.preventDefault();
        handleReferencePaste();
        return;
      }
      // Ctrl+V: paste image from clipboard (B-1)
      if (e.ctrlKey && !e.shiftKey && e.key === "v") {
        e.preventDefault();
        handleClipboardPaste();
        return;
      }
      // B = brush
      if (!e.ctrlKey && !e.altKey && e.key === "b") {
        setMode("brush");
        return;
      }
      // I = eyedropper
      if (!e.ctrlKey && !e.altKey && e.key === "i") {
        setMode("eyedropper");
        return;
      }
      // R = replace-all
      if (!e.ctrlKey && !e.altKey && e.key === "r") {
        setMode("replace-all");
        return;
      }
      // T = text tool
      if (!e.ctrlKey && !e.altKey && e.key === "t") {
        setMode("text");
        return;
      }
      // U = shape tool
      if (!e.ctrlKey && !e.altKey && e.key === "u") {
        setMode("shape");
        return;
      }
      // Escape: cancel text draft
      if (e.key === "Escape") {
        setTextDraft(null);
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorHistory, naturalWidth, naturalHeight, zoom, triggerRedraw]);
}
