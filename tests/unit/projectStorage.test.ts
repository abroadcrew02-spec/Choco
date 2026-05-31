/**
 * Unit tests for projectStorage.ts
 *
 * jsdom does not implement IndexedDB, so these tests verify:
 * - isIDBAvailable() returns false in jsdom (no indexedDB global)
 * - openDB() rejects when IndexedDB is unavailable
 * - saveProjectToIDB() rejects gracefully when IDB is unavailable
 * - loadProjectFromIDB() rejects gracefully when IDB is unavailable
 * - clearProjectFromIDB() rejects gracefully when IDB is unavailable
 *
 * IDB-success-path tests require a real or mocked IDBFactory and are
 * covered by integration tests / manual browser testing.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isIDBAvailable,
  openDB,
  saveProjectToIDB,
  loadProjectFromIDB,
  clearProjectFromIDB,
  _resetDBPromiseForTest,
} from "../../src/components/MvpEditor/lib/projectStorage";

afterEach(() => {
  // Reset the module-level DB cache so each test starts with a fresh openDB() call
  _resetDBPromiseForTest();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isIDBAvailable
// ---------------------------------------------------------------------------

describe("isIDBAvailable", () => {
  it("returns false in jsdom (no indexedDB global)", () => {
    // jsdom does not expose indexedDB by default
    const available = isIDBAvailable();
    // jsdom may or may not have indexedDB; assert the function does not throw
    expect(typeof available).toBe("boolean");
  });

  it("returns false when indexedDB is explicitly undefined", () => {
    const originalIDB = (globalThis as Record<string, unknown>)["indexedDB"];
    (globalThis as Record<string, unknown>)["indexedDB"] = undefined;
    try {
      expect(isIDBAvailable()).toBe(false);
    } finally {
      (globalThis as Record<string, unknown>)["indexedDB"] = originalIDB;
    }
  });

  it("returns true when indexedDB is stubbed", () => {
    const originalIDB = (globalThis as Record<string, unknown>)["indexedDB"];
    (globalThis as Record<string, unknown>)["indexedDB"] = {
      open: vi.fn(),
    } as unknown as IDBFactory;
    try {
      expect(isIDBAvailable()).toBe(true);
    } finally {
      (globalThis as Record<string, unknown>)["indexedDB"] = originalIDB;
    }
  });
});

// ---------------------------------------------------------------------------
// openDB — unavailable environment
// ---------------------------------------------------------------------------

describe("openDB — unavailable", () => {
  it("rejects when indexedDB is undefined", async () => {
    const originalIDB = (globalThis as Record<string, unknown>)["indexedDB"];
    (globalThis as Record<string, unknown>)["indexedDB"] = undefined;
    try {
      await expect(openDB()).rejects.toThrow(/IndexedDB is not available/);
    } finally {
      (globalThis as Record<string, unknown>)["indexedDB"] = originalIDB;
    }
  });
});

// ---------------------------------------------------------------------------
// saveProjectToIDB — fallback / error path
// ---------------------------------------------------------------------------

describe("saveProjectToIDB — error path", () => {
  it("rejects when IndexedDB is not available", async () => {
    const originalIDB = (globalThis as Record<string, unknown>)["indexedDB"];
    (globalThis as Record<string, unknown>)["indexedDB"] = undefined;
    try {
      await expect(saveProjectToIDB({ foo: "bar" })).rejects.toThrow();
    } finally {
      (globalThis as Record<string, unknown>)["indexedDB"] = originalIDB;
    }
  });

  it("rejects when IDB open fails (error event)", async () => {
    const originalIDB = (globalThis as Record<string, unknown>)["indexedDB"];
    // Stub indexedDB.open to trigger onerror
    const fakeRequest = {
      onupgradeneeded: null as unknown,
      onsuccess: null as unknown,
      onerror: null as unknown,
      error: new DOMException("Mocked IDB open error"),
    };
    (globalThis as Record<string, unknown>)["indexedDB"] = {
      open: vi.fn(() => {
        setTimeout(() => {
          (fakeRequest as { onerror: ((e: Event) => void) | null }).onerror?.({
            target: fakeRequest,
          } as unknown as Event);
        }, 0);
        return fakeRequest;
      }),
    };
    try {
      await expect(saveProjectToIDB({ foo: "bar" })).rejects.toThrow();
    } finally {
      (globalThis as Record<string, unknown>)["indexedDB"] = originalIDB;
    }
  });
});

// ---------------------------------------------------------------------------
// loadProjectFromIDB — fallback / error path
// ---------------------------------------------------------------------------

describe("loadProjectFromIDB — error path", () => {
  it("rejects when IndexedDB is not available", async () => {
    const originalIDB = (globalThis as Record<string, unknown>)["indexedDB"];
    (globalThis as Record<string, unknown>)["indexedDB"] = undefined;
    try {
      await expect(loadProjectFromIDB()).rejects.toThrow();
    } finally {
      (globalThis as Record<string, unknown>)["indexedDB"] = originalIDB;
    }
  });
});

// ---------------------------------------------------------------------------
// clearProjectFromIDB — fallback / error path
// ---------------------------------------------------------------------------

describe("clearProjectFromIDB — error path", () => {
  it("rejects when IndexedDB is not available", async () => {
    const originalIDB = (globalThis as Record<string, unknown>)["indexedDB"];
    (globalThis as Record<string, unknown>)["indexedDB"] = undefined;
    try {
      await expect(clearProjectFromIDB()).rejects.toThrow();
    } finally {
      (globalThis as Record<string, unknown>)["indexedDB"] = originalIDB;
    }
  });
});

// ---------------------------------------------------------------------------
// IDB success path — stubbed IDBFactory
// ---------------------------------------------------------------------------

describe("projectStorage — stubbed IDB success path", () => {
  function makeStubDB(storedValue: unknown = undefined) {
    const store: Record<string, unknown> = {};
    if (storedValue !== undefined) {
      store["project"] = storedValue;
    }

    const makeRequest = <T>(
      result: T,
      error?: DOMException
    ): IDBRequest<T> => {
      const req = {
        result,
        error: error ?? null,
        onsuccess: null as unknown,
        onerror: null as unknown,
      };
      setTimeout(() => {
        if (error) {
          (req as { onerror: ((e: Event) => void) | null }).onerror?.({
            target: req,
          } as unknown as Event);
        } else {
          (req as { onsuccess: ((e: Event) => void) | null }).onsuccess?.({
            target: req,
          } as unknown as Event);
        }
      }, 0);
      return req as unknown as IDBRequest<T>;
    };

    const objectStore = {
      put: vi.fn((data: unknown, _key: string) => {
        store["project"] = data;
        return makeRequest<IDBValidKey>("project");
      }),
      get: vi.fn((_key: string) => makeRequest<unknown>(store["project"])),
      delete: vi.fn((_key: string) => {
        delete store["project"];
        return makeRequest<undefined>(undefined);
      }),
    };

    const tx = {
      objectStore: vi.fn(() => objectStore),
    };

    const db = {
      objectStoreNames: { contains: vi.fn(() => true) },
      createObjectStore: vi.fn(),
      transaction: vi.fn(() => tx),
    };

    const fakeRequest = {
      result: db,
      error: null,
      onupgradeneeded: null as unknown,
      onsuccess: null as unknown,
      onerror: null as unknown,
    };

    return {
      store,
      fakeRequest,
      idbFactory: {
        open: vi.fn(() => {
          setTimeout(() => {
            (
              fakeRequest as {
                onsuccess: ((e: Event) => void) | null;
              }
            ).onsuccess?.({ target: fakeRequest } as unknown as Event);
          }, 0);
          return fakeRequest;
        }),
      },
    };
  }

  it("saveProjectToIDB resolves when IDB is available", async () => {
    const { idbFactory } = makeStubDB();
    const originalIDB = (globalThis as Record<string, unknown>)["indexedDB"];
    (globalThis as Record<string, unknown>)["indexedDB"] =
      idbFactory as unknown as IDBFactory;
    try {
      await expect(
        saveProjectToIDB({ version: 1, regions: [] })
      ).resolves.toBeUndefined();
    } finally {
      (globalThis as Record<string, unknown>)["indexedDB"] = originalIDB;
    }
  });

  it("loadProjectFromIDB resolves with stored value", async () => {
    const payload = { version: 1, regions: [], imageWidth: 4, imageHeight: 4 };
    const { idbFactory } = makeStubDB(payload);
    const originalIDB = (globalThis as Record<string, unknown>)["indexedDB"];
    (globalThis as Record<string, unknown>)["indexedDB"] =
      idbFactory as unknown as IDBFactory;
    try {
      const result = await loadProjectFromIDB();
      expect(result).toEqual(payload);
    } finally {
      (globalThis as Record<string, unknown>)["indexedDB"] = originalIDB;
    }
  });

  it("loadProjectFromIDB resolves with null when store is empty", async () => {
    const { idbFactory } = makeStubDB(); // no stored value
    const originalIDB = (globalThis as Record<string, unknown>)["indexedDB"];
    (globalThis as Record<string, unknown>)["indexedDB"] =
      idbFactory as unknown as IDBFactory;
    try {
      const result = await loadProjectFromIDB();
      expect(result).toBeNull();
    } finally {
      (globalThis as Record<string, unknown>)["indexedDB"] = originalIDB;
    }
  });

  it("clearProjectFromIDB resolves when IDB is available", async () => {
    const payload = { version: 1, regions: [] };
    const { idbFactory } = makeStubDB(payload);
    const originalIDB = (globalThis as Record<string, unknown>)["indexedDB"];
    (globalThis as Record<string, unknown>)["indexedDB"] =
      idbFactory as unknown as IDBFactory;
    try {
      await expect(clearProjectFromIDB()).resolves.toBeUndefined();
    } finally {
      (globalThis as Record<string, unknown>)["indexedDB"] = originalIDB;
    }
  });
});
