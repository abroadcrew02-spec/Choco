import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// ShortcutHelp — right-click shortcut popover
// ---------------------------------------------------------------------------
//
// Displays a keyboard shortcut reference table anchored at (x, y).
// Clamps to viewport edges. Closes on outside click or Escape key.
//

interface ShortcutHelpProps {
  x: number;
  y: number;
  onClose: () => void;
}

const SHORTCUTS: { key: string; action: string; isSection?: boolean }[] = [
  // Navigation
  { key: "Ctrl + ホイール", action: "拡大 / 縮小" },
  { key: "スペース + ドラッグ", action: "手のひら (パン)" },
  { key: "Ctrl+Z", action: "元に戻す" },
  { key: "Ctrl+Y", action: "やり直し" },
  { key: "Ctrl+0", action: "画面にフィット" },
  { key: "Ctrl+V", action: "クリップボードから貼り付け" },
  { key: "Esc", action: "HSVピッカーを閉じる" },
  // Tool shortcuts section
  { key: "ツール切替", action: "", isSection: true },
  { key: "B", action: "ブラシ" },
  { key: "I", action: "スポイト" },
  { key: "R", action: "同色一括置換" },
  { key: "G", action: "色変更 (Color)" },
  { key: "E", action: "透過 (Transparent)" },
];

const PANEL_BG = "#1c1c1c";
const BORDER_COLOR = "rgba(255,255,255,0.14)";
const TEXT_PRIMARY = "#e8e8e8";
const TEXT_MUTED = "#888";
const TEXT_DIM = "#666";

export function ShortcutHelp({ x, y, onClose }: ShortcutHelpProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  // After mount, clamp position to viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    if (rect.right > vw - margin) {
      el.style.left = Math.max(margin, vw - rect.width - margin) + "px";
    }
    if (rect.bottom > vh - margin) {
      el.style.top = Math.max(margin, vh - rect.height - margin) + "px";
    }
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="キーボードショートカット一覧"
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 9000,
        background: PANEL_BG,
        border: `1px solid ${BORDER_COLOR}`,
        borderRadius: 6,
        padding: "10px 14px",
        boxShadow: "0 6px 24px rgba(0,0,0,0.65)",
        minWidth: 260,
      }}
    >
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          fontFamily: "'Inter','Noto Sans JP',system-ui,sans-serif",
          fontSize: 11,
        }}
      >
        <tbody>
          {SHORTCUTS.map((row, i) =>
            row.isSection ? (
              <tr key={i}>
                <td
                  colSpan={2}
                  style={{
                    color: TEXT_DIM,
                    paddingTop: 10,
                    paddingBottom: 2,
                    fontSize: 10,
                  }}
                >
                  {row.key}
                </td>
              </tr>
            ) : (
              <tr key={i}>
                <td
                  style={{
                    color: TEXT_MUTED,
                    paddingTop: 3,
                    paddingBottom: 3,
                    paddingRight: 12,
                    whiteSpace: "nowrap",
                    fontFamily: "monospace",
                  }}
                >
                  {row.key}
                </td>
                <td
                  style={{
                    color: TEXT_PRIMARY,
                    paddingTop: 3,
                    paddingBottom: 3,
                  }}
                >
                  {row.action}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
