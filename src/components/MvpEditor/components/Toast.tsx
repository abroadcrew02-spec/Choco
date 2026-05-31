import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Toast component — floating notification (top-right)
// ---------------------------------------------------------------------------
//
// State machine: idle → entering (200ms) → visible (2500ms) → exiting (300ms) → idle
//
// Props:
//   message   — text to display (empty string = hidden)
//   type      — "success" | "error"
//   onDismiss — called when the toast finishes exiting
//

export type ToastType = "success" | "error" | "info";

export interface ToastMessage {
  message: string;
  type: ToastType;
  id: number;
}

type ToastPhase = "idle" | "entering" | "visible" | "exiting";

const ENTERING_MS = 200;
const VISIBLE_MS = 2500;
const EXITING_MS = 300;

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

const SUCCESS_BG = "#4caf7d";
const ERROR_BG = "#e05555";
const INFO_BG = "#4f8ef7";

export function Toast({ toast, onDismiss }: ToastProps) {
  const [phase, setPhase] = useState<ToastPhase>("idle");
  const [displayedToast, setDisplayedToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    if (!toast) return;

    // Immediately show the new toast, resetting any previous phase
    setDisplayedToast(toast);
    setPhase("entering");

    const t1 = setTimeout(() => setPhase("visible"), ENTERING_MS);
    const t2 = setTimeout(() => setPhase("exiting"), ENTERING_MS + VISIBLE_MS);
    const t3 = setTimeout(() => {
      setPhase("idle");
      setDisplayedToast(null);
      onDismiss();
    }, ENTERING_MS + VISIBLE_MS + EXITING_MS);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.id]);

  if (phase === "idle" || !displayedToast) return null;

  const isEntering = phase === "entering";
  const isExiting = phase === "exiting";
  const opacity = isEntering || isExiting ? 0 : 1;
  const translateY = isEntering ? -8 : isExiting ? -8 : 0;
  const bgColor =
    displayedToast.type === "error" ? ERROR_BG :
    displayedToast.type === "info"  ? INFO_BG  :
    SUCCESS_BG;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 9999,
        background: bgColor,
        color: "#fff",
        borderRadius: 6,
        padding: "8px 14px",
        fontSize: 12,
        fontFamily: "'Inter','Noto Sans JP',system-ui,sans-serif",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        pointerEvents: "none",
        opacity,
        transform: `translateY(${translateY}px)`,
        transition: `opacity ${isEntering ? ENTERING_MS : EXITING_MS}ms ease, transform ${isEntering ? ENTERING_MS : EXITING_MS}ms ease`,
        maxWidth: 280,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {displayedToast.message}
    </div>
  );
}
