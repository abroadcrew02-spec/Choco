import { useState, useCallback } from "react";
import type { AnchorPosition, ResizeMode } from "../lib/canvasResize";

// ---------------------------------------------------------------------------
// Design tokens (mirrored from parent to avoid coupling)
// ---------------------------------------------------------------------------

const T = {
  color: {
    bgBase:      "#141414",
    bgPanel:     "#1c1c1c",
    bgElevated:  "#242424",
    border:      "rgba(255,255,255,0.08)",
    borderMid:   "rgba(255,255,255,0.14)",
    textPrimary: "#e8e8e8",
    textMuted:   "#888",
    textDim:     "#666",
    accent:      "#4f8ef7",
    accentHover: "#6aa3ff",
    overlay:     "rgba(0,0,0,0.65)",
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const,
  radius: { sm: 4, md: 6, lg: 10 } as const,
  font: {
    family: "'Inter','Noto Sans JP',system-ui,sans-serif",
    label:  11,
    body:   13,
  },
} as const;

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface Preset {
  label: string;
  width: number;
  height: number;
}

const PRESETS: Preset[] = [
  { label: "SNS (1080×1080)",      width: 1080, height: 1080 },
  { label: "ロゴ標準 (512×512)",    width: 512,  height: 512  },
  { label: "名刺 (1004×650)",       width: 1004, height: 650  },
  { label: "FHD (1920×1080)",       width: 1920, height: 1080 },
];

// ---------------------------------------------------------------------------
// Anchor grid component
// ---------------------------------------------------------------------------

const ANCHORS: AnchorPosition[] = [
  "top-left",    "top-center",    "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
];

function AnchorGrid({
  value,
  onChange,
}: {
  value: AnchorPosition;
  onChange: (a: AnchorPosition) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 20px)",
        gap: 3,
      }}
    >
      {ANCHORS.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onChange(a)}
          title={a}
          style={{
            width: 20,
            height: 20,
            padding: 0,
            background: value === a ? T.color.accent : T.color.bgElevated,
            border: `1px solid ${value === a ? T.color.accent : T.color.borderMid}`,
            borderRadius: T.radius.sm,
            cursor: "pointer",
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CanvasSizeModalProps {
  currentWidth: number;
  currentHeight: number;
  onApply: (
    newWidth: number,
    newHeight: number,
    anchor: AnchorPosition,
    mode: ResizeMode
  ) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CanvasSizeModal({
  currentWidth,
  currentHeight,
  onApply,
  onClose,
}: CanvasSizeModalProps) {
  const [width, setWidth] = useState(currentWidth);
  const [height, setHeight] = useState(currentHeight);
  const [anchor, setAnchor] = useState<AnchorPosition>("middle-center");
  const [mode, setMode] = useState<ResizeMode>("crop");

  const handlePreset = useCallback((preset: Preset) => {
    setWidth(preset.width);
    setHeight(preset.height);
  }, []);

  const handleApply = useCallback(() => {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    onApply(w, h, anchor, mode);
  }, [width, height, anchor, mode, onApply]);

  const inputStyle: React.CSSProperties = {
    width: 72,
    background: T.color.bgBase,
    border: `1px solid ${T.color.borderMid}`,
    borderRadius: T.radius.sm,
    color: T.color.textPrimary,
    fontFamily: T.font.family,
    fontSize: T.font.body,
    padding: "3px 6px",
    outline: "none",
    textAlign: "right",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: T.font.label,
    color: T.color.textMuted,
    fontFamily: T.font.family,
  };

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: T.font.label,
    color: T.color.textMuted,
    fontFamily: T.font.family,
    marginBottom: T.space.xs,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  };

  const btnStyle: React.CSSProperties = {
    background: T.color.bgElevated,
    border: `1px solid ${T.color.borderMid}`,
    borderRadius: T.radius.sm,
    color: T.color.textPrimary,
    fontFamily: T.font.family,
    fontSize: T.font.body,
    padding: "5px 14px",
    cursor: "pointer",
  };

  const btnAccentStyle: React.CSSProperties = {
    ...btnStyle,
    background: T.color.accent,
    border: `1px solid ${T.color.accent}`,
    color: "#fff",
    fontWeight: 600,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: T.color.overlay,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: T.color.bgPanel,
          border: `1px solid ${T.color.borderMid}`,
          borderRadius: T.radius.lg,
          padding: T.space.xl,
          width: 360,
          boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
          display: "flex",
          flexDirection: "column",
          gap: T.space.lg,
          fontFamily: T.font.family,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: T.color.textPrimary }}>
            キャンバスサイズ変更
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: T.color.textMuted,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: 2,
            }}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        {/* Current size info */}
        <div style={{ fontSize: T.font.label, color: T.color.textDim }}>
          現在: {currentWidth} × {currentHeight} px
        </div>

        {/* New size inputs */}
        <div>
          <div style={sectionHeaderStyle}>新しいサイズ</div>
          <div style={{ display: "flex", alignItems: "center", gap: T.space.sm }}>
            <span style={labelStyle}>幅</span>
            <input
              type="number"
              min={1}
              max={8192}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              style={inputStyle}
            />
            <span style={labelStyle}>×</span>
            <span style={labelStyle}>高さ</span>
            <input
              type="number"
              min={1}
              max={8192}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              style={inputStyle}
            />
            <span style={labelStyle}>px</span>
          </div>
        </div>

        {/* Presets */}
        <div>
          <div style={sectionHeaderStyle}>プリセット</div>
          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: T.space.xs }}>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => handlePreset(p)}
                style={{
                  ...btnStyle,
                  padding: "3px 8px",
                  fontSize: T.font.label,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Mode */}
        <div>
          <div style={sectionHeaderStyle}>モード</div>
          <div style={{ display: "flex", gap: T.space.sm }}>
            {(["crop", "scale"] as ResizeMode[]).map((m) => (
              <label
                key={m}
                style={{
                  ...labelStyle,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  cursor: "pointer",
                  color: mode === m ? T.color.textPrimary : T.color.textMuted,
                }}
              >
                <input
                  type="radio"
                  name="resize-mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  style={{ cursor: "pointer" }}
                />
                {m === "crop" ? "クロップ（はみ出しを切り取る）" : "リサイズ（全体を縮小拡大）"}
              </label>
            ))}
          </div>
        </div>

        {/* Anchor — shown only in crop mode */}
        {mode === "crop" && (
          <div>
            <div style={sectionHeaderStyle}>配置（アンカー）</div>
            <AnchorGrid value={anchor} onChange={setAnchor} />
            <div style={{ ...labelStyle, marginTop: T.space.xs }}>
              選択: {anchor}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: T.space.sm }}>
          <button type="button" onClick={onClose} style={btnStyle}>
            キャンセル
          </button>
          <button type="button" onClick={handleApply} style={btnAccentStyle}>
            適用
          </button>
        </div>
      </div>
    </div>
  );
}
