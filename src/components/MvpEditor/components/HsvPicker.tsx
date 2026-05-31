import { useRef, useEffect, useCallback, useState } from "react";
import {
  complementary,
  triadic,
  analogous,
  splitComplementary,
} from "../lib/colorHarmony";
import { formatColor, type ColorFormat } from "../lib/colorFormats";

const COLOR_FORMATS: ColorFormat[] = ["HEX", "RGB", "HSL", "CMYK"];

// ---------------------------------------------------------------------------
// HSV color conversions (ported from logo_recolor_4.html)
// ---------------------------------------------------------------------------

export function hsv2rgb(
  h: number,
  s: number,
  v: number
): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function rgb2hsv(
  r: number,
  g: number,
  b: number
): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const mx = Math.max(rn, gn, bn);
  const mn = Math.min(rn, gn, bn);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === rn) h = ((gn - bn) / d) % 6;
    else if (mx === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
}

// ---------------------------------------------------------------------------
// Canvas drawing helpers
// ---------------------------------------------------------------------------

const PSIZE = 220;
const PCX = 110;
const PCY = 110;
const RING_OUT = 105;
const RING_IN = 80;
const SV = 110;

function drawRingMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number
): void {
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPickerCanvas(
  canvas: HTMLCanvasElement,
  h: number,
  s: number,
  v: number
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, PSIZE, PSIZE);

  // Hue ring (conic gradient)
  const grad = ctx.createConicGradient(-Math.PI / 2, PCX, PCY);
  for (let i = 0; i <= 12; i++) {
    grad.addColorStop(i / 12, `hsl(${i * 30},100%,50%)`);
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(PCX, PCY, RING_OUT, 0, Math.PI * 2);
  ctx.fill();

  // Punch out inner circle
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(PCX, PCY, RING_IN, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // SV square
  const x0 = PCX - SV / 2;
  const y0 = PCY - SV / 2;

  ctx.fillStyle = `hsl(${h},100%,50%)`;
  ctx.fillRect(x0, y0, SV, SV);

  const g1 = ctx.createLinearGradient(x0, 0, x0 + SV, 0);
  g1.addColorStop(0, "#fff");
  g1.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g1;
  ctx.fillRect(x0, y0, SV, SV);

  const g2 = ctx.createLinearGradient(0, y0, 0, y0 + SV);
  g2.addColorStop(0, "rgba(0,0,0,0)");
  g2.addColorStop(1, "#000");
  ctx.fillStyle = g2;
  ctx.fillRect(x0, y0, SV, SV);

  // Hue ring marker
  const ha = (h - 90) * (Math.PI / 180);
  const hr = (RING_OUT + RING_IN) / 2;
  drawRingMarker(ctx, PCX + Math.cos(ha) * hr, PCY + Math.sin(ha) * hr, 7);

  // SV square marker
  drawRingMarker(ctx, x0 + s * SV, y0 + (1 - v) * SV, 5);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface HsvPickerProps {
  /** Current color as hex string (e.g. "#ff0000") */
  hex: string;
  /** Called when the user selects a new color */
  onChange: (hex: string) => void;
  /** Called when the picker should close (click outside) */
  onClose: () => void;
}

type PickMode = "h" | "sv" | null;

export function HsvPicker({ hex, onChange, onClose }: HsvPickerProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pickModeRef = useRef<PickMode>(null);

  // Parse hex → HSV on mount and when hex changes externally
  const parseHex = (h: string): { r: number; g: number; b: number } => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    if (!result) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    };
  };

  const [hsv, setHsv] = useState<{ h: number; s: number; v: number }>(() => {
    const { r, g, b } = parseHex(hex);
    return rgb2hsv(r, g, b);
  });

  // Sync HSV when hex prop changes from outside (e.g. eyedropper)
  useEffect(() => {
    const { r, g, b } = parseHex(hex);
    const newHsv = rgb2hsv(r, g, b);
    setHsv((prev) => {
      // Preserve hue when s or v is zero to avoid hue jumping
      if (newHsv.s < 0.001) return { h: prev.h, s: newHsv.s, v: newHsv.v };
      if (newHsv.v < 0.001) return { h: prev.h, s: newHsv.s, v: newHsv.v };
      return newHsv;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex]);

  // Redraw canvas when HSV changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawPickerCanvas(canvas, hsv.h, hsv.s, hsv.v);
  }, [hsv]);

  // Close on outside click
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (!container.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  const applyHsv = useCallback(
    (h: number, s: number, v: number) => {
      const { r, g, b } = hsv2rgb(h, s, v);
      const newHex =
        "#" +
        [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
      onChange(newHex);
    },
    [onChange]
  );

  const updHue = useCallback(
    (px: number, py: number, currentHsv: { h: number; s: number; v: number }) => {
      let a = Math.atan2(py - PCY, px - PCX) * (180 / Math.PI) + 90;
      if (a < 0) a += 360;
      const newHsv = { ...currentHsv, h: a };
      setHsv(newHsv);
      applyHsv(newHsv.h, newHsv.s, newHsv.v);
    },
    [applyHsv]
  );

  const updSV = useCallback(
    (px: number, py: number, currentHsv: { h: number; s: number; v: number }) => {
      const x0 = PCX - SV / 2;
      const y0 = PCY - SV / 2;
      const s = Math.max(0, Math.min(1, (px - x0) / SV));
      const v = Math.max(0, Math.min(1, 1 - (py - y0) / SV));
      const newHsv = { ...currentHsv, s, v };
      setHsv(newHsv);
      applyHsv(newHsv.h, newHsv.s, newHsv.v);
    },
    [applyHsv]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const dx = px - PCX;
      const dy = py - PCY;
      const d = Math.sqrt(dx * dx + dy * dy);

      if (d <= RING_OUT && d >= RING_IN) {
        pickModeRef.current = "h";
        updHue(px, py, hsv);
      } else if (Math.abs(dx) <= SV / 2 && Math.abs(dy) <= SV / 2) {
        pickModeRef.current = "sv";
        updSV(px, py, hsv);
      }
      e.preventDefault();
    },
    [hsv, updHue, updSV]
  );

  // Global mouse move/up for dragging outside canvas bounds
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const mode = pickModeRef.current;
      if (!mode) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (mode === "h") {
        updHue(px, py, hsv);
      } else {
        updSV(px, py, hsv);
      }
    };
    const handleMouseUp = () => {
      pickModeRef.current = null;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [hsv, updHue, updSV]);

  // Hex input state (local, synced bidirectionally)
  const [hexInput, setHexInput] = useState(hex.toUpperCase());
  useEffect(() => {
    setHexInput(hex.toUpperCase());
  }, [hex]);

  // Color format toggle state
  const [colorFormat, setColorFormat] = useState<ColorFormat>("HEX");

  // Harmony swatches derived from current hex
  const harmonyGroups: Array<{ label: string; colors: string[] }> = [
    { label: "補色", colors: [complementary(hex)] },
    { label: "三角", colors: triadic(hex) },
    { label: "類似", colors: analogous(hex) },
    { label: "分裂補色", colors: splitComplementary(hex) },
  ];

  const handleHexInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.trim();
    setHexInput(val.toUpperCase());
    if (!val.startsWith("#")) val = "#" + val;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      onChange(val.toLowerCase());
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        background: "#2a2a2a",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 6,
        padding: 10,
        zIndex: 200,
        boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
        userSelect: "none",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <canvas
        ref={canvasRef}
        width={PSIZE}
        height={PSIZE}
        style={{ display: "block", cursor: "crosshair" }}
        onMouseDown={handleMouseDown}
      />
      {/* Format toggle */}
      <div
        style={{
          marginTop: 8,
          display: "flex",
          gap: 2,
        }}
      >
        {COLOR_FORMATS.map((fmt) => (
          <button
            key={fmt}
            type="button"
            onClick={() => setColorFormat(fmt)}
            style={{
              flex: 1,
              padding: "2px 0",
              fontSize: 10,
              background: colorFormat === fmt ? "#666" : "#333",
              color: colorFormat === fmt ? "#fff" : "rgba(255,255,255,0.5)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 3,
              cursor: "pointer",
            }}
          >
            {fmt}
          </button>
        ))}
      </div>

      {/* Color value display / input */}
      <div
        style={{
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: hex,
            border: "1px solid rgba(255,255,255,0.2)",
            flexShrink: 0,
          }}
        />
        {colorFormat === "HEX" ? (
          <input
            type="text"
            aria-label="HEXカラー値"
            value={hexInput}
            onChange={handleHexInput}
            maxLength={7}
            style={{
              flex: 1,
              background: "#444",
              color: "#eee",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 3,
              padding: "4px 6px",
              fontSize: 12,
              fontFamily: "monospace",
              textTransform: "uppercase",
            }}
            spellCheck={false}
          />
        ) : (
          <input
            type="text"
            aria-label={`${colorFormat}カラー値`}
            readOnly
            value={formatColor(hex, colorFormat)}
            style={{
              flex: 1,
              background: "#333",
              color: "rgba(255,255,255,0.7)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 3,
              padding: "4px 6px",
              fontSize: 11,
              fontFamily: "monospace",
              cursor: "default",
            }}
          />
        )}
      </div>

      {/* Color harmony section */}
      <div
        style={{
          marginTop: 10,
          borderTop: "1px solid rgba(255,255,255,0.1)",
          paddingTop: 8,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.45)",
            marginBottom: 6,
            letterSpacing: "0.04em",
          }}
        >
          ハーモニー
        </div>
        {harmonyGroups.map(({ label, colors }) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginBottom: 4,
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.5)",
                width: 48,
                flexShrink: 0,
              }}
            >
              {label}
            </span>
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                title={c.toUpperCase()}
                onClick={() => onChange(c)}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 3,
                  background: c,
                  border: "1px solid rgba(255,255,255,0.2)",
                  cursor: "pointer",
                  flexShrink: 0,
                  padding: 0,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
