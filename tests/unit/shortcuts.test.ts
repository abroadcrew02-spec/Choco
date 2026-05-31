/**
 * Unit tests for lib/shortcuts.ts (Issue #53)
 *
 * Covers:
 * - getShortcut(): returns default key when no custom mapping exists
 * - setShortcut() + getShortcut(): persists a custom key and returns it
 * - resetShortcuts(): clears all custom mappings, restoring defaults
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getShortcut,
  setShortcut,
  resetShortcuts,
  getAllShortcuts,
  SHORTCUT_DEFS,
} from "../../src/components/MvpEditor/lib/shortcuts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearStorage() {
  try {
    localStorage.removeItem("choco:shortcuts");
  } catch {
    // jsdom may not support localStorage; vitest sets it up by default
  }
}

beforeEach(() => {
  clearStorage();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getShortcut()
// ---------------------------------------------------------------------------

describe("getShortcut()", () => {
  it("returns the default key for each action when nothing is stored", () => {
    for (const def of SHORTCUT_DEFS) {
      expect(getShortcut(def.id)).toBe(def.defaultKey);
    }
  });

  it("returns lowercase default key regardless of case stored in defaults", () => {
    // Defaults are already lowercase, but verify the contract holds
    expect(getShortcut("brush")).toBe("b");
    expect(getShortcut("eyedropper")).toBe("i");
    expect(getShortcut("replaceAll")).toBe("r");
  });
});

// ---------------------------------------------------------------------------
// setShortcut() + getShortcut() round-trip
// ---------------------------------------------------------------------------

describe("setShortcut()", () => {
  it("persists a custom key and getShortcut() returns it", () => {
    setShortcut("brush", "q");
    expect(getShortcut("brush")).toBe("q");
  });

  it("stores the key in lowercase even when given uppercase", () => {
    setShortcut("text", "K");
    expect(getShortcut("text")).toBe("k");
  });

  it("removing a custom mapping by passing the default key restores default", () => {
    setShortcut("shape", "x");
    expect(getShortcut("shape")).toBe("x");
    // Passing the default key clears the customization
    setShortcut("shape", "u"); // "u" is the default for shape
    expect(getShortcut("shape")).toBe("u");
  });

  it("does not affect unrelated actions", () => {
    setShortcut("brush", "q");
    expect(getShortcut("eyedropper")).toBe("i");
    expect(getShortcut("replaceAll")).toBe("r");
  });
});

// ---------------------------------------------------------------------------
// resetShortcuts()
// ---------------------------------------------------------------------------

describe("resetShortcuts()", () => {
  it("restores all defaults after custom mappings are set", () => {
    setShortcut("brush", "q");
    setShortcut("text", "k");
    resetShortcuts();
    for (const def of SHORTCUT_DEFS) {
      expect(getShortcut(def.id)).toBe(def.defaultKey);
    }
  });
});

// ---------------------------------------------------------------------------
// getAllShortcuts()
// ---------------------------------------------------------------------------

describe("getAllShortcuts()", () => {
  it("returns all actions with their effective keys", () => {
    const all = getAllShortcuts();
    expect(Object.keys(all).length).toBe(SHORTCUT_DEFS.length);
    for (const def of SHORTCUT_DEFS) {
      expect(all[def.id]).toBe(def.defaultKey);
    }
  });

  it("reflects custom mappings in the returned map", () => {
    setShortcut("color", "f");
    const all = getAllShortcuts();
    expect(all["color"]).toBe("f");
  });
});
