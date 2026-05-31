// ---------------------------------------------------------------------------
// Color harmony utilities — HSL-based harmonic color calculations
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HSL conversion helpers
// ---------------------------------------------------------------------------

/** Convert hex string (#rrggbb) to HSL (h: 0-360, s: 0-1, l: 0-1). */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { h: 0, s: 0, l: 0 };
  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l };
  }

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let h = 0;
  if (max === r) {
    h = ((g - b) / delta) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }
  h = ((h * 60) + 360) % 360;

  return { h, s, l };
}

/** Convert HSL (h: 0-360, s: 0-1, l: 0-1) to hex string (#rrggbb). */
export function hslToHex(h: number, s: number, l: number): string {
  const hNorm = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hNorm / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (hNorm < 60)       { r = c; g = x; b = 0; }
  else if (hNorm < 120) { r = x; g = c; b = 0; }
  else if (hNorm < 180) { r = 0; g = c; b = x; }
  else if (hNorm < 240) { r = 0; g = x; b = c; }
  else if (hNorm < 300) { r = x; g = 0; b = c; }
  else                  { r = c; g = 0; b = x; }

  const toHex = (v: number) =>
    Math.round(Math.max(0, Math.min(255, (v + m) * 255)))
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ---------------------------------------------------------------------------
// Harmony functions
// ---------------------------------------------------------------------------

/**
 * Complementary color: hue rotated by 180 degrees.
 * Returns a single hex color.
 */
export function complementary(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h + 180, s, l);
}

/**
 * Triadic colors: hue rotated by +120 and +240 degrees.
 * Returns two hex colors.
 */
export function triadic(hex: string): [string, string] {
  const { h, s, l } = hexToHsl(hex);
  return [hslToHex(h + 120, s, l), hslToHex(h + 240, s, l)];
}

/**
 * Analogous colors: hue shifted by -30 and +30 degrees.
 * Returns two hex colors.
 */
export function analogous(hex: string): [string, string] {
  const { h, s, l } = hexToHsl(hex);
  return [hslToHex(h - 30, s, l), hslToHex(h + 30, s, l)];
}

/**
 * Split-complementary colors: hue rotated by +150 and +210 degrees.
 * Returns two hex colors.
 */
export function splitComplementary(hex: string): [string, string] {
  const { h, s, l } = hexToHsl(hex);
  return [hslToHex(h + 150, s, l), hslToHex(h + 210, s, l)];
}
