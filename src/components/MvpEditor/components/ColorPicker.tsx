import { useState, useCallback, useEffect } from "react";

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  recentColors: string[];
  onRecentColorAdd: (hex: string) => void;
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return [Math.round(h), Math.round(s * 100), Math.round(v * 100)];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

const inputStyle: React.CSSProperties = {
  width: 48,
  background: "#333",
  color: "#f0f0f0",
  border: "1px solid #555",
  borderRadius: 3,
  padding: "2px 4px",
  fontSize: 12,
  textAlign: "center",
};

const labelSmallStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#888",
  marginRight: 2,
};

export function ColorPicker({ value, onChange, recentColors, onRecentColorAdd }: ColorPickerProps) {
  const [hexInput, setHexInput] = useState(value);
  const [rgb, setRgb] = useState<[number, number, number]>(() => hexToRgb(value));
  const [hsv, setHsv] = useState<[number, number, number]>(() => {
    const [r, g, b] = hexToRgb(value);
    return rgbToHsv(r, g, b);
  });

  // Sync local state when outer value changes
  useEffect(() => {
    const [r, g, b] = hexToRgb(value);
    setRgb([r, g, b]);
    setHsv(rgbToHsv(r, g, b));
    setHexInput(value);
  }, [value]);

  const applyHex = useCallback(
    (hex: string) => {
      const clean = hex.startsWith("#") ? hex : "#" + hex;
      if (/^#[0-9a-f]{6}$/i.test(clean)) {
        onChange(clean);
        onRecentColorAdd(clean);
      }
    },
    [onChange, onRecentColorAdd]
  );

  const handleNativeColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const hex = e.target.value;
      onChange(hex);
      onRecentColorAdd(hex);
    },
    [onChange, onRecentColorAdd]
  );

  const handleHexBlur = useCallback(() => {
    applyHex(hexInput);
  }, [hexInput, applyHex]);

  const handleHexKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") applyHex(hexInput);
    },
    [hexInput, applyHex]
  );

  const handleRgbChange = useCallback(
    (channel: 0 | 1 | 2, rawVal: string) => {
      const num = Math.max(0, Math.min(255, parseInt(rawVal, 10) || 0));
      const next: [number, number, number] = [...rgb] as [number, number, number];
      next[channel] = num;
      setRgb(next);
      const hex = rgbToHex(...next);
      onChange(hex);
      onRecentColorAdd(hex);
    },
    [rgb, onChange, onRecentColorAdd]
  );

  const handleHsvChange = useCallback(
    (channel: 0 | 1 | 2, rawVal: string) => {
      const max = channel === 0 ? 360 : 100;
      const num = Math.max(0, Math.min(max, parseInt(rawVal, 10) || 0));
      const next: [number, number, number] = [...hsv] as [number, number, number];
      next[channel] = num;
      setHsv(next);
      const [r, g, b] = hsvToRgb(...next);
      const hex = rgbToHex(r, g, b);
      onChange(hex);
      onRecentColorAdd(hex);
    },
    [hsv, onChange, onRecentColorAdd]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Native color picker + HEX */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="color"
          value={value}
          onChange={handleNativeColorChange}
          style={{ width: 36, height: 28, cursor: "pointer", border: "none", borderRadius: 4, flexShrink: 0 }}
          title="カラーピッカー"
        />
        <span style={labelSmallStyle}>HEX</span>
        <input
          type="text"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={handleHexBlur}
          onKeyDown={handleHexKeyDown}
          style={{ ...inputStyle, width: 72 }}
          maxLength={7}
          placeholder="#rrggbb"
        />
      </div>

      {/* RGB inputs */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={labelSmallStyle}>R</span>
        <input
          type="number"
          min={0}
          max={255}
          value={rgb[0]}
          onChange={(e) => handleRgbChange(0, e.target.value)}
          style={inputStyle}
        />
        <span style={labelSmallStyle}>G</span>
        <input
          type="number"
          min={0}
          max={255}
          value={rgb[1]}
          onChange={(e) => handleRgbChange(1, e.target.value)}
          style={inputStyle}
        />
        <span style={labelSmallStyle}>B</span>
        <input
          type="number"
          min={0}
          max={255}
          value={rgb[2]}
          onChange={(e) => handleRgbChange(2, e.target.value)}
          style={inputStyle}
        />
      </div>

      {/* HSV inputs */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={labelSmallStyle}>H</span>
        <input
          type="number"
          min={0}
          max={360}
          value={hsv[0]}
          onChange={(e) => handleHsvChange(0, e.target.value)}
          style={inputStyle}
        />
        <span style={labelSmallStyle}>S</span>
        <input
          type="number"
          min={0}
          max={100}
          value={hsv[1]}
          onChange={(e) => handleHsvChange(1, e.target.value)}
          style={inputStyle}
        />
        <span style={labelSmallStyle}>V</span>
        <input
          type="number"
          min={0}
          max={100}
          value={hsv[2]}
          onChange={(e) => handleHsvChange(2, e.target.value)}
          style={inputStyle}
        />
      </div>

      {/* Recent colors */}
      {recentColors.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <span style={labelSmallStyle}>履歴:</span>
          {recentColors.map((c, i) => (
            <button
              key={`${c}-${i}`}
              type="button"
              title={c}
              onClick={() => onChange(c)}
              style={{
                width: 18,
                height: 18,
                background: c,
                border: c === value ? "2px solid #fff" : "1px solid #666",
                borderRadius: 3,
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
