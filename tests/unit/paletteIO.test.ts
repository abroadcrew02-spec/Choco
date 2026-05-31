/**
 * Unit tests for paletteIO.ts
 *
 * Covers:
 * - serializePaletteSet: produces version 1 JSON with name and colors
 * - serializePaletteSet / deserializePaletteSet: round-trip
 * - deserializePaletteSet: rejects invalid JSON
 * - deserializePaletteSet: rejects unsupported version
 * - deserializePaletteSet: rejects missing/empty name
 * - deserializePaletteSet: rejects non-array colors
 * - deserializePaletteSet: rejects colors with non-hex values
 */

import { describe, it, expect } from "vitest";
import {
  serializePaletteSet,
  deserializePaletteSet,
  type PaletteSet,
} from "../../src/components/MvpEditor/lib/paletteIO";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSet(overrides?: Partial<PaletteSet>): PaletteSet {
  return {
    id: "ps-test-1",
    name: "Brand Colors",
    colors: ["#ff0000", "#00ff00", "#0000ff"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// serializePaletteSet
// ---------------------------------------------------------------------------

describe("serializePaletteSet", () => {
  it("produces version 1 JSON", () => {
    const json = serializePaletteSet(makeSet());
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
  });

  it("includes name and colors", () => {
    const set = makeSet();
    const parsed = JSON.parse(serializePaletteSet(set));
    expect(parsed.name).toBe("Brand Colors");
    expect(parsed.colors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });

  it("does not include id in output", () => {
    const parsed = JSON.parse(serializePaletteSet(makeSet()));
    expect(parsed).not.toHaveProperty("id");
  });
});

// ---------------------------------------------------------------------------
// deserializePaletteSet — round-trip
// ---------------------------------------------------------------------------

describe("deserializePaletteSet — round-trip", () => {
  it("restores name and colors from serialized JSON", () => {
    const set = makeSet();
    const json = serializePaletteSet(set);
    const restored = deserializePaletteSet(json);
    expect(restored).not.toBeNull();
    expect(restored!.name).toBe("Brand Colors");
    expect(restored!.colors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });

  it("assigns a fresh id on import (not the original id)", () => {
    const set = makeSet({ id: "ps-original" });
    const json = serializePaletteSet(set);
    const restored = deserializePaletteSet(json);
    expect(restored).not.toBeNull();
    expect(restored!.id).not.toBe("ps-original");
    expect(restored!.id).toMatch(/^ps-/);
  });

  it("handles empty colors array", () => {
    const set = makeSet({ colors: [] });
    const json = serializePaletteSet(set);
    const restored = deserializePaletteSet(json);
    expect(restored).not.toBeNull();
    expect(restored!.colors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deserializePaletteSet — invalid input
// ---------------------------------------------------------------------------

describe("deserializePaletteSet — invalid input", () => {
  it("returns null for invalid JSON string", () => {
    expect(deserializePaletteSet("not json {{")).toBeNull();
  });

  it("returns null for wrong version", () => {
    const json = JSON.stringify({ version: 2, name: "Test", colors: [] });
    expect(deserializePaletteSet(json)).toBeNull();
  });

  it("returns null when name is missing", () => {
    const json = JSON.stringify({ version: 1, colors: ["#ff0000"] });
    expect(deserializePaletteSet(json)).toBeNull();
  });

  it("returns null when name is empty string", () => {
    const json = JSON.stringify({ version: 1, name: "   ", colors: ["#ff0000"] });
    expect(deserializePaletteSet(json)).toBeNull();
  });

  it("returns null when colors is not an array", () => {
    const json = JSON.stringify({ version: 1, name: "Test", colors: "red" });
    expect(deserializePaletteSet(json)).toBeNull();
  });

  it("returns null when a color is not a valid hex string", () => {
    const json = JSON.stringify({ version: 1, name: "Test", colors: ["red", "#00ff00"] });
    expect(deserializePaletteSet(json)).toBeNull();
  });

  it("returns null for JSON array at root", () => {
    const json = JSON.stringify([{ version: 1, name: "Test", colors: [] }]);
    expect(deserializePaletteSet(json)).toBeNull();
  });

  it("returns null for JSON null at root", () => {
    expect(deserializePaletteSet("null")).toBeNull();
  });
});
