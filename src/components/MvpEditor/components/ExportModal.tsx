import { useState, useEffect, useRef, useCallback } from "react";
import { t, type Lang } from "../lib/i18n";

// ---------------------------------------------------------------------------
// ExportModal — Image export with format + resolution selection
// ---------------------------------------------------------------------------
//
// Supports PNG / JPEG / WebP output formats with 1x / 2x / 4x / custom scale.
// JPEG exposes a quality slider (0–100, default 90).
// Shows final resolution and rough file-size estimate.
//

// ---------------------------------------------------------------------------
// Design tokens (duplicated here to keep component self-contained)
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
    success:     "#4caf7d",
    overlay:     "rgba(0,0,0,0.72)",
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
// Types
// ---------------------------------------------------------------------------

export type ExportFormat = "png" | "jpeg" | "webp";
export type ScalePreset = "original" | "1x" | "2x" | "4x" | "custom";

export interface ExportOptions {
  format: ExportFormat;
  scale: ScalePreset;
  customWidth: number;
  customHeight: number;
  quality: number; // 0–100 (used for JPEG)
}

interface ExportModalProps {
  naturalWidth: number;
  naturalHeight: number;
  onExport: (options: ExportOptions) => void;
  onClose: () => void;
  lang: Lang;
}

// ---------------------------------------------------------------------------
// Pure utility functions (exported for testing)
// ---------------------------------------------------------------------------

/** Returns the MIME type string for a given ExportFormat. */
export function getMimeType(format: ExportFormat): string {
  switch (format) {
    case "png":  return "image/png";
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
  }
}

/** Returns the file extension (without dot) for a given ExportFormat. */
export function getFileExtension(format: ExportFormat): string {
  switch (format) {
    case "png":  return "png";
    case "jpeg": return "jpg";
    case "webp": return "webp";
  }
}

/**
 * Calculates the output dimensions given source size and export options.
 * "original" maps to 1x, "custom" uses customWidth/customHeight directly.
 */
export function calcOutputSize(
  naturalWidth: number,
  naturalHeight: number,
  options: Pick<ExportOptions, "scale" | "customWidth" | "customHeight">
): { width: number; height: number } {
  switch (options.scale) {
    case "original":
    case "1x":
      return { width: naturalWidth, height: naturalHeight };
    case "2x":
      return { width: naturalWidth * 2, height: naturalHeight * 2 };
    case "4x":
      return { width: naturalWidth * 4, height: naturalHeight * 4 };
    case "custom":
      return {
        width: Math.max(1, options.customWidth),
        height: Math.max(1, options.customHeight),
      };
  }
}

/**
 * Rough estimated file size in bytes.
 * PNG: ~0.5 bits/pixel; JPEG/WebP: quality-dependent (4–12 bits/pixel).
 */
export function estimateFileSizeBytes(
  width: number,
  height: number,
  format: ExportFormat,
  quality: number
): number {
  const pixels = width * height;
  if (format === "png") {
    return Math.round(pixels * 0.5);
  }
  // JPEG / WebP: map quality 0–100 to bits per pixel 0.5–4
  const bpp = 0.5 + (quality / 100) * 3.5;
  return Math.round((pixels * bpp) / 8);
}

/** Formats a byte count to a human-readable string like "~240 KB". */
export function formatFileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `~${bytes} B`;
  if (bytes < 1024 * 1024) return `~${Math.round(bytes / 1024)} KB`;
  return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// ExportModal component
// ---------------------------------------------------------------------------

export function ExportModal({
  naturalWidth,
  naturalHeight,
  onExport,
  onClose,
  lang,
}: ExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>("png");
  const [scale, setScale] = useState<ScalePreset>("1x");
  const [quality, setQuality] = useState(90);
  const [customWidth, setCustomWidth] = useState(naturalWidth);
  const [customHeight, setCustomHeight] = useState(naturalHeight);

  const panelRef = useRef<HTMLDivElement>(null);

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

  // Close on outside click
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // Keep custom dimensions in sync when scale preset changes away from custom
  const handleScaleChange = useCallback((next: ScalePreset) => {
    setScale(next);
    if (next !== "custom") {
      const out = calcOutputSize(naturalWidth, naturalHeight, {
        scale: next,
        customWidth,
        customHeight,
      });
      setCustomWidth(out.width);
      setCustomHeight(out.height);
    }
  }, [naturalWidth, naturalHeight, customWidth, customHeight]);

  const outputSize = calcOutputSize(naturalWidth, naturalHeight, {
    scale,
    customWidth,
    customHeight,
  });

  const estimatedBytes = estimateFileSizeBytes(
    outputSize.width,
    outputSize.height,
    format,
    quality
  );

  const handleSubmit = () => {
    onExport({
      format,
      scale,
      customWidth: outputSize.width,
      customHeight: outputSize.height,
      quality,
    });
    onClose();
  };

  // ---------------------------------------------------------------------------
  // Styles (inline, T-token based)
  // ---------------------------------------------------------------------------

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: T.color.overlay,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9100,
  };

  const panelStyle: React.CSSProperties = {
    background: T.color.bgPanel,
    border: `1px solid ${T.color.borderMid}`,
    borderRadius: T.radius.lg,
    boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
    padding: T.space.xl,
    minWidth: 340,
    maxWidth: 400,
    fontFamily: T.font.family,
    color: T.color.textPrimary,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: T.space.lg,
    color: T.color.textPrimary,
  };

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: T.font.label,
    color: T.color.textMuted,
    marginBottom: T.space.xs,
    display: "block",
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    gap: T.space.sm,
    marginBottom: T.space.md,
    flexWrap: "wrap",
  };

  const radioGroupStyle: React.CSSProperties = {
    display: "flex",
    gap: T.space.sm,
    flexWrap: "wrap",
  };

  const radioLabelStyle = (active: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 10px",
    background: active ? T.color.accent : T.color.bgElevated,
    border: `1px solid ${active ? T.color.accent : T.color.borderMid}`,
    borderRadius: T.radius.sm,
    fontSize: T.font.label,
    color: T.color.textPrimary,
    cursor: "pointer",
    userSelect: "none",
    transition: "background 120ms",
  });

  const inputStyle: React.CSSProperties = {
    background: T.color.bgElevated,
    border: `1px solid ${T.color.borderMid}`,
    borderRadius: T.radius.sm,
    color: T.color.textPrimary,
    fontSize: T.font.label,
    fontFamily: T.font.family,
    padding: "3px 6px",
    width: 72,
  };

  const previewBoxStyle: React.CSSProperties = {
    background: T.color.bgElevated,
    border: `1px solid ${T.color.border}`,
    borderRadius: T.radius.sm,
    padding: `${T.space.sm}px ${T.space.md}px`,
    marginBottom: T.space.md,
    fontSize: T.font.label,
    color: T.color.textMuted,
    lineHeight: 1.8,
  };

  const footerStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "flex-end",
    gap: T.space.sm,
    marginTop: T.space.lg,
  };

  const btnStyle: React.CSSProperties = {
    padding: "5px 14px",
    borderRadius: T.radius.sm,
    fontSize: T.font.label,
    fontFamily: T.font.family,
    cursor: "pointer",
    border: `1px solid ${T.color.borderMid}`,
    background: T.color.bgElevated,
    color: T.color.textPrimary,
  };

  const btnPrimaryStyle: React.CSSProperties = {
    ...btnStyle,
    background: T.color.success,
    border: `1px solid ${T.color.success}`,
    color: "#fff",
  };

  const SCALE_PRESETS: ScalePreset[] = ["original", "1x", "2x", "4x", "custom"];
  const FORMAT_OPTIONS: ExportFormat[] = ["png", "jpeg", "webp"];

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="画像出力設定">
      <div ref={panelRef} style={panelStyle}>
        <div style={titleStyle}>画像出力</div>

        {/* Format selection */}
        <span style={sectionLabelStyle}>出力形式</span>
        <div style={{ ...rowStyle, marginBottom: T.space.lg }}>
          <div style={radioGroupStyle}>
            {FORMAT_OPTIONS.map((f) => (
              <label key={f} style={radioLabelStyle(format === f)}>
                <input
                  type="radio"
                  name="export-format"
                  value={f}
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  style={{ display: "none" }}
                />
                {f.toUpperCase()}
              </label>
            ))}
          </div>
        </div>

        {/* Scale selection */}
        <span style={sectionLabelStyle}>出力サイズ</span>
        <div style={{ ...rowStyle, marginBottom: T.space.lg }}>
          <div style={radioGroupStyle}>
            {SCALE_PRESETS.map((s) => (
              <label key={s} style={radioLabelStyle(scale === s)}>
                <input
                  type="radio"
                  name="export-scale"
                  value={s}
                  checked={scale === s}
                  onChange={() => handleScaleChange(s)}
                  style={{ display: "none" }}
                />
                {s === "original" ? "元サイズ" : s === "custom" ? "カスタム" : s}
              </label>
            ))}
          </div>
        </div>

        {/* Custom dimensions */}
        {scale === "custom" && (
          <div style={{ marginBottom: T.space.lg }}>
            <span style={sectionLabelStyle}>カスタムサイズ (px)</span>
            <div style={{ display: "flex", alignItems: "center", gap: T.space.sm }}>
              <input
                type="number"
                min={1}
                max={16384}
                value={customWidth}
                onChange={(e) => setCustomWidth(Math.max(1, Number(e.target.value) || 1))}
                style={inputStyle}
                aria-label="出力幅"
              />
              <span style={{ color: T.color.textDim, fontSize: T.font.label }}>×</span>
              <input
                type="number"
                min={1}
                max={16384}
                value={customHeight}
                onChange={(e) => setCustomHeight(Math.max(1, Number(e.target.value) || 1))}
                style={inputStyle}
                aria-label="出力高さ"
              />
            </div>
          </div>
        )}

        {/* JPEG quality */}
        {format === "jpeg" && (
          <div style={{ marginBottom: T.space.lg }}>
            <span style={sectionLabelStyle}>画質: {quality}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              style={{ width: "100%", accentColor: T.color.accent }}
              aria-label={t("aria.jpegQuality", lang)}
              aria-valuetext={String(quality)}
            />
          </div>
        )}

        {/* Preview info */}
        <div style={previewBoxStyle}>
          <div>
            最終解像度: <strong style={{ color: T.color.textPrimary }}>
              {outputSize.width} × {outputSize.height}
            </strong>
          </div>
          <div>
            推定サイズ: <strong style={{ color: T.color.textPrimary }}>
              {formatFileSizeLabel(estimatedBytes)}
            </strong>
          </div>
        </div>

        {/* Footer buttons */}
        <div style={footerStyle}>
          <button type="button" style={btnStyle} onClick={onClose}>
            キャンセル
          </button>
          <button type="button" style={btnPrimaryStyle} onClick={handleSubmit}>
            書き出し
          </button>
        </div>
      </div>
    </div>
  );
}
