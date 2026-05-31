// ---------------------------------------------------------------------------
// Color format conversion utilities
// ---------------------------------------------------------------------------

import { hexToRgb } from "./imageProcessing";
import { hexToHsl } from "./colorHarmony";

export type ColorFormat = "HEX" | "RGB" | "HSL" | "CMYK";

/**
 * Convert RGB (0-255) to CMYK percentages (0-100).
 * Uses simplified RGB→CMYK formula (no ICC profile).
 */
export function rgbToCmyk(
  r: number,
  g: number,
  b: number
): [c: number, m: number, y: number, k: number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const k = 1 - Math.max(rn, gn, bn);
  if (k === 1) return [0, 0, 0, 100];

  const inv = 1 - k;
  const c = (1 - rn - k) / inv;
  const m = (1 - gn - k) / inv;
  const y = (1 - bn - k) / inv;

  return [
    Math.round(c * 100),
    Math.round(m * 100),
    Math.round(y * 100),
    Math.round(k * 100),
  ];
}

/**
 * Format a hex color string as the requested display format.
 * Returns the color value as a human-readable string.
 */
export function formatColor(hex: string, format: ColorFormat): string {
  switch (format) {
    case "HEX":
      return hex.toUpperCase();

    case "RGB": {
      const [r, g, b] = hexToRgb(hex);
      return `${r}, ${g}, ${b}`;
    }

    case "HSL": {
      const { h, s, l } = hexToHsl(hex);
      return `${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
    }

    case "CMYK": {
      const [r, g, b] = hexToRgb(hex);
      const [c, m, y, k] = rgbToCmyk(r, g, b);
      return `${c}%, ${m}%, ${y}%, ${k}%`;
    }
  }
}
