import { useState } from "react";

// ---------------------------------------------------------------------------
// Types (exported for use in MvpEditor)
// ---------------------------------------------------------------------------

export type FillType = "solid" | "linearGradient" | "radialGradient";

export interface GradientStop {
  position: number; // 0.0 - 1.0
  color: string;    // hex string e.g. "#ff0000"
}

export interface GradientConfig {
  stops: GradientStop[];
  /** Linear gradient angle in degrees (0 = top→bottom, 90 = left→right) */
  angle: number;
}

// ---------------------------------------------------------------------------
// Token subset (keep in sync with parent)
// ---------------------------------------------------------------------------

const TC = {
  bgPanel:    "#1c1c1c",
  bgElevated: "#242424",
  border:     "rgba(255,255,255,0.08)",
  borderMid:  "rgba(255,255,255,0.14)",
  textPrimary:"#e8e8e8",
  textMuted:  "#888",
  textDim:    "#666",
  accent:     "#4f8ef7",
  danger:     "#e05555",
  dangerDark: "#7a1a1a",
  font:  { family: "'Inter','Noto Sans JP',system-ui,sans-serif", label: 11, badge: 10 },
  space: { xs: 4, sm: 8 },
  radius: { sm: 4, md: 6 },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a CSS linear-gradient string from stops + angle, for preview only.
 */
export function buildCssLinearGradient(stops: GradientStop[], angle: number): string {
  if (stops.length === 0) return "transparent";
  const stopStrs = stops
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.color} ${Math.round(s.position * 100)}%`);
  return `linear-gradient(${angle}deg, ${stopStrs.join(", ")})`;
}

/**
 * Builds a CSS radial-gradient string from stops, for preview only.
 */
export function buildCssRadialGradient(stops: GradientStop[]): string {
  if (stops.length === 0) return "transparent";
  const stopStrs = stops
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.color} ${Math.round(s.position * 100)}%`);
  return `radial-gradient(ellipse at center, ${stopStrs.join(", ")})`;
}

/**
 * Applies a linear gradient as fillStyle on a canvas context.
 * The gradient runs from (x,y) to (x+w, y+h) rotated by the angle.
 */
export function applyLinearGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  stops: GradientStop[],
  angle: number
): void {
  // Convert angle (degrees, 0=top→bottom, 90=left→right) to direction vector
  const rad = ((angle - 90) * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  // half-diagonal length determines gradient extent
  const halfLen = Math.hypot(w, h) / 2;
  const x0 = cx - Math.cos(rad) * halfLen;
  const y0 = cy - Math.sin(rad) * halfLen;
  const x1 = cx + Math.cos(rad) * halfLen;
  const y1 = cy + Math.sin(rad) * halfLen;

  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  const sorted = stops.slice().sort((a, b) => a.position - b.position);
  for (const s of sorted) {
    grad.addColorStop(Math.max(0, Math.min(1, s.position)), s.color);
  }
  ctx.fillStyle = grad;
}

/**
 * Applies a radial gradient as fillStyle on a canvas context.
 * Gradient is centered at the bounding box center with radius = min(w,h)/2.
 */
export function applyRadialGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  stops: GradientStop[]
): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.max(w, h) / 2;

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  const sorted = stops.slice().sort((a, b) => a.position - b.position);
  for (const s of sorted) {
    grad.addColorStop(Math.max(0, Math.min(1, s.position)), s.color);
  }
  ctx.fillStyle = grad;
}

// ---------------------------------------------------------------------------
// Default gradient config
// ---------------------------------------------------------------------------

export const DEFAULT_GRADIENT_CONFIG: GradientConfig = {
  stops: [
    { position: 0, color: "#ff0000" },
    { position: 1, color: "#0000ff" },
  ],
  angle: 0,
};

// ---------------------------------------------------------------------------
// GradientEditor component
// ---------------------------------------------------------------------------

interface GradientEditorProps {
  fillType: FillType;
  gradientConfig: GradientConfig;
  onFillTypeChange: (ft: FillType) => void;
  onGradientConfigChange: (cfg: GradientConfig) => void;
  onClose: () => void;
}

export function GradientEditor({
  fillType,
  gradientConfig,
  onFillTypeChange,
  onGradientConfigChange,
  onClose,
}: GradientEditorProps) {
  const [editingStopIdx, setEditingStopIdx] = useState<number | null>(null);

  const stops = gradientConfig.stops;

  function updateStop(idx: number, patch: Partial<GradientStop>) {
    const next = stops.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onGradientConfigChange({ ...gradientConfig, stops: next });
  }

  function addStop() {
    const pos = stops.length > 0 ? Math.min(1, stops[stops.length - 1].position + 0.2) : 0.5;
    const newStop: GradientStop = { position: Math.min(1, pos), color: "#ffffff" };
    onGradientConfigChange({ ...gradientConfig, stops: [...stops, newStop] });
  }

  function removeStop(idx: number) {
    if (stops.length <= 2) return; // minimum 2 stops
    const next = stops.filter((_, i) => i !== idx);
    onGradientConfigChange({ ...gradientConfig, stops: next });
    if (editingStopIdx === idx) setEditingStopIdx(null);
  }

  const previewGradient =
    fillType === "linearGradient"
      ? buildCssLinearGradient(stops, gradientConfig.angle)
      : fillType === "radialGradient"
        ? buildCssRadialGradient(stops)
        : stops[0]?.color ?? "#ff0000";

  return (
    <div
      style={{
        background: TC.bgPanel,
        border: `1px solid ${TC.borderMid}`,
        borderRadius: TC.radius.md,
        padding: TC.space.sm,
        width: 220,
        boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
        fontFamily: TC.font.family,
        fontSize: TC.font.label,
        color: TC.textPrimary,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: TC.space.sm }}>
        <span style={{ fontSize: TC.font.label, color: TC.textMuted }}>塗り種別</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: TC.textMuted,
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            padding: "0 2px",
          }}
          aria-label="閉じる"
        >
          ×
        </button>
      </div>

      {/* Fill type selector */}
      <div style={{ display: "flex", gap: TC.space.xs, marginBottom: TC.space.sm }}>
        {(["solid", "linearGradient", "radialGradient"] as FillType[]).map((ft) => (
          <button
            key={ft}
            type="button"
            onClick={() => onFillTypeChange(ft)}
            style={{
              flex: 1,
              padding: "3px 4px",
              background: fillType === ft ? TC.accent : TC.bgElevated,
              color: fillType === ft ? "#fff" : TC.textMuted,
              border: `1px solid ${fillType === ft ? TC.accent : TC.borderMid}`,
              borderRadius: TC.radius.sm,
              cursor: "pointer",
              fontSize: TC.font.badge,
              fontFamily: TC.font.family,
            }}
          >
            {ft === "solid" ? "単色" : ft === "linearGradient" ? "線形" : "円形"}
          </button>
        ))}
      </div>

      {/* Gradient preview bar */}
      {fillType !== "solid" && (
        <div
          style={{
            height: 20,
            borderRadius: TC.radius.sm,
            background: previewGradient,
            border: `1px solid ${TC.borderMid}`,
            marginBottom: TC.space.sm,
          }}
        />
      )}

      {/* Angle control — linear only */}
      {fillType === "linearGradient" && (
        <div style={{ display: "flex", alignItems: "center", gap: TC.space.xs, marginBottom: TC.space.sm }}>
          <span style={{ color: TC.textMuted, fontSize: TC.font.label, width: 52, flexShrink: 0 }}>
            角度: {gradientConfig.angle}°
          </span>
          <input
            type="range"
            min={0}
            max={360}
            value={gradientConfig.angle}
            onChange={(e) =>
              onGradientConfigChange({ ...gradientConfig, angle: Number(e.target.value) })
            }
            style={{ flex: 1 }}
            title="グラデーション角度 (0-360°)"
          />
        </div>
      )}

      {/* Stops list */}
      {fillType !== "solid" && (
        <div>
          <div style={{ color: TC.textDim, fontSize: TC.font.badge, marginBottom: TC.space.xs }}>
            色ストップ ({stops.length})
          </div>
          {stops.map((stop, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "center",
                gap: TC.space.xs,
                marginBottom: 4,
              }}
            >
              {/* Color picker */}
              <input
                type="color"
                value={stop.color}
                onChange={(e) => updateStop(idx, { color: e.target.value })}
                style={{
                  width: 22,
                  height: 22,
                  border: `1px solid ${TC.borderMid}`,
                  borderRadius: TC.radius.sm,
                  padding: 0,
                  cursor: "pointer",
                  background: "none",
                  outline: "none",
                  flexShrink: 0,
                }}
                title={`ストップ ${idx + 1} の色`}
              />
              {/* Position slider */}
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={stop.position}
                onChange={(e) => updateStop(idx, { position: Number(e.target.value) })}
                style={{ flex: 1 }}
                title={`位置: ${Math.round(stop.position * 100)}%`}
              />
              <span style={{ color: TC.textDim, fontSize: TC.font.badge, width: 28, textAlign: "right", flexShrink: 0 }}>
                {Math.round(stop.position * 100)}%
              </span>
              {/* Remove */}
              <button
                type="button"
                onClick={() => removeStop(idx)}
                disabled={stops.length <= 2}
                style={{
                  background: stops.length <= 2 ? "transparent" : TC.dangerDark,
                  color: stops.length <= 2 ? TC.textDim : TC.danger,
                  border: "none",
                  borderRadius: TC.radius.sm,
                  cursor: stops.length <= 2 ? "default" : "pointer",
                  fontSize: TC.font.badge,
                  padding: "1px 4px",
                  flexShrink: 0,
                  fontFamily: TC.font.family,
                }}
                title="ストップを削除"
              >
                x
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addStop}
            style={{
              width: "100%",
              marginTop: TC.space.xs,
              padding: "2px 6px",
              background: TC.bgElevated,
              color: TC.textMuted,
              border: `1px solid ${TC.borderMid}`,
              borderRadius: TC.radius.sm,
              cursor: "pointer",
              fontSize: TC.font.badge,
              fontFamily: TC.font.family,
            }}
            title="色ストップを追加"
          >
            + ストップ追加
          </button>
        </div>
      )}
    </div>
  );
}
