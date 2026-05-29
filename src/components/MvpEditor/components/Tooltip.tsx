import { useRef, useState, useCallback } from "react";

interface TooltipProps {
  label: string;
  shortcut?: string;
  children: React.ReactNode;
}

/**
 * Lightweight tooltip wrapper. Shows label + optional keyboard shortcut badge
 * after a 200ms hover delay with a 150ms opacity fade-in.
 * No external dependencies — pure CSS via inline styles.
 */
export function Tooltip({ label, shortcut, children }: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), 200);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  return (
    <div
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {visible && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(30,30,30,0.96)",
            color: "#e8e8e8",
            fontSize: 11,
            fontFamily: "'Inter','Noto Sans JP',system-ui,sans-serif",
            padding: "4px 7px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 300,
            border: "1px solid rgba(255,255,255,0.1)",
            display: "flex",
            alignItems: "center",
            gap: 5,
            animation: "tooltipFadeIn 150ms ease forwards",
          }}
        >
          <span>{label}</span>
          {shortcut && (
            <span
              style={{
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 3,
                padding: "1px 4px",
                fontSize: 10,
                fontFamily: "monospace",
                color: "#bbb",
              }}
            >
              {shortcut}
            </span>
          )}
        </div>
      )}
      <style>{`
        @keyframes tooltipFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
