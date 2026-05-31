/**
 * Unit tests for WelcomeModal localStorage helpers (Issue #29).
 *
 * Covers:
 * - hasSeenWelcome(): returns false when key is absent
 * - hasSeenWelcome(): returns true after markWelcomeSeen()
 * - markWelcomeSeen() + resetWelcomeSeen(): full round-trip
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  hasSeenWelcome,
  markWelcomeSeen,
  resetWelcomeSeen,
  WELCOME_SEEN_KEY,
} from "../../src/components/MvpEditor/components/WelcomeModal";

beforeEach(() => {
  localStorage.clear();
});

describe("hasSeenWelcome()", () => {
  it("returns false when localStorage key is absent (first visit)", () => {
    expect(hasSeenWelcome()).toBe(false);
  });

  it("returns true after markWelcomeSeen() is called", () => {
    markWelcomeSeen();
    expect(hasSeenWelcome()).toBe(true);
  });

  it("resets to false after resetWelcomeSeen() clears the key", () => {
    markWelcomeSeen();
    expect(hasSeenWelcome()).toBe(true);
    resetWelcomeSeen();
    expect(hasSeenWelcome()).toBe(false);
  });
});

describe("WELCOME_SEEN_KEY", () => {
  it("markWelcomeSeen writes '1' to the correct localStorage key", () => {
    markWelcomeSeen();
    expect(localStorage.getItem(WELCOME_SEEN_KEY)).toBe("1");
  });

  it("resetWelcomeSeen removes the localStorage key entirely", () => {
    markWelcomeSeen();
    resetWelcomeSeen();
    expect(localStorage.getItem(WELCOME_SEEN_KEY)).toBeNull();
  });
});
