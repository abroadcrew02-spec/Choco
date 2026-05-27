import { useEffect } from "react";

type Mode = "color" | "transparent";

interface UseKeyboardShortcutsOptions {
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onScale100: () => void;
  onModeChange: (mode: Mode) => void;
  setSpacePressed: (pressed: boolean) => void;
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    (el as HTMLElement).isContentEditable
  );
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const { onUndo, onRedo, onFit, onScale100, onModeChange, setSpacePressed } = options;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInputFocused()) return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        onUndo();
        return;
      }
      if (ctrl && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        onRedo();
        return;
      }
      if (ctrl && e.key === "0") {
        e.preventDefault();
        onFit();
        return;
      }
      if (ctrl && e.key === "1") {
        e.preventDefault();
        onScale100();
        return;
      }
      if (e.code === "Space" && !ctrl) {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }
      if (e.key === "b" && !ctrl) {
        onModeChange("color");
        return;
      }
      if (e.key === "e" && !ctrl) {
        onModeChange("transparent");
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
  }, [onUndo, onRedo, onFit, onScale100, onModeChange, setSpacePressed]);
}
