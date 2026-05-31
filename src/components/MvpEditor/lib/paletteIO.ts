/**
 * paletteIO.ts
 *
 * Serialize / deserialize a palette set to/from the .json export format.
 *
 * File format version 1:
 * {
 *   version: 1,
 *   name: string,
 *   colors: string[],  // hex color strings, e.g. ["#ff0000", "#00ff00"]
 * }
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaletteSet {
  id: string;
  name: string;
  colors: string[];
}

export interface SerializedPaletteSet {
  version: 1;
  name: string;
  colors: string[];
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/**
 * Converts a PaletteSet to a JSON string in the export format.
 */
export function serializePaletteSet(set: PaletteSet): string {
  const payload: SerializedPaletteSet = {
    version: 1,
    name: set.name,
    colors: set.colors,
  };
  return JSON.stringify(payload, null, 2);
}

// ---------------------------------------------------------------------------
// Deserialize
// ---------------------------------------------------------------------------

/**
 * Parses a JSON string and returns a PaletteSet, or null on validation failure.
 * Only version 1 is accepted. A fresh id is assigned on import.
 */
export function deserializePaletteSet(json: string): PaletteSet | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  if (obj["version"] !== 1) {
    return null;
  }

  if (typeof obj["name"] !== "string" || obj["name"].trim() === "") {
    return null;
  }

  if (!Array.isArray(obj["colors"])) {
    return null;
  }

  const colors = obj["colors"] as unknown[];
  if (!colors.every((c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c))) {
    return null;
  }

  return {
    id: `ps-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: (obj["name"] as string).trim(),
    colors: colors as string[],
  };
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Triggers a browser download of the palette set as a .json file.
 * The filename is derived from the palette name.
 */
export function downloadPaletteSet(set: PaletteSet): void {
  const json = serializePaletteSet(set);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = set.name.replace(/[^a-zA-Z0-9぀-鿿_-]/g, "_") || "palette";
  a.href = url;
  a.download = `${safeName}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
