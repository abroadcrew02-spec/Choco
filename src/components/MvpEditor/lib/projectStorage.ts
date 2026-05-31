/**
 * projectStorage.ts
 *
 * IndexedDB-backed async storage for Choco autosave.
 *
 * Database: "choco-db"
 * Object store: "autosave"
 * Key: AUTOSAVE_IDB_KEY ("project")
 *
 * Stores the full ChocoProject (including image as PNG data URL), which allows
 * complete autosave recovery — unlike the localStorage-based ChocoProjectLite
 * that intentionally omitted image data to avoid quota exhaustion.
 *
 * Falls back gracefully when IndexedDB is unavailable (e.g. private browsing,
 * jsdom test environment). All public functions return Promises and never throw;
 * errors are logged and swallowed so the caller can fall back to localStorage.
 */

const DB_NAME = "choco-db";
const DB_VERSION = 1;
const STORE_NAME = "autosave";
export const AUTOSAVE_IDB_KEY = "project";

// ---------------------------------------------------------------------------
// Internal: open (or create) the database
// ---------------------------------------------------------------------------

let _dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Opens the IndexedDB database, creating the object store on first use.
 * The returned Promise rejects if IndexedDB is not available.
 */
export function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined" || indexedDB === null) {
      reject(new Error("[projectStorage] IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      _dbPromise = null; // allow retry on next call
      reject(
        new Error(
          "[projectStorage] Failed to open IndexedDB: " +
            String((event.target as IDBOpenDBRequest).error)
        )
      );
    };
  });

  return _dbPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Saves an arbitrary serializable value to IndexedDB under AUTOSAVE_IDB_KEY.
 *
 * Resolves when the transaction commits successfully.
 * Rejects if IndexedDB is unavailable or the write fails.
 */
export function saveProjectToIDB(data: unknown): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(data, AUTOSAVE_IDB_KEY);

        request.onsuccess = () => resolve();
        request.onerror = (event) => {
          reject(
            new Error(
              "[projectStorage] IDB put failed: " +
                String((event.target as IDBRequest).error)
            )
          );
        };
      })
  );
}

/**
 * Loads the autosave entry from IndexedDB.
 *
 * Resolves with the stored value, or null if no entry exists.
 * Rejects if IndexedDB is unavailable or the read fails.
 */
export function loadProjectFromIDB(): Promise<unknown | null> {
  return openDB().then(
    (db) =>
      new Promise<unknown | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(AUTOSAVE_IDB_KEY);

        request.onsuccess = (event) => {
          const result = (event.target as IDBRequest<unknown>).result;
          resolve(result !== undefined ? result : null);
        };
        request.onerror = (event) => {
          reject(
            new Error(
              "[projectStorage] IDB get failed: " +
                String((event.target as IDBRequest).error)
            )
          );
        };
      })
  );
}

/**
 * Removes the autosave entry from IndexedDB.
 *
 * Resolves when the delete commits. Rejects if IndexedDB is unavailable.
 */
export function clearProjectFromIDB(): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(AUTOSAVE_IDB_KEY);

        request.onsuccess = () => resolve();
        request.onerror = (event) => {
          reject(
            new Error(
              "[projectStorage] IDB delete failed: " +
                String((event.target as IDBRequest).error)
            )
          );
        };
      })
  );
}

/**
 * Returns true if IndexedDB appears to be available in the current environment.
 * Does not open the database — safe to call synchronously.
 */
export function isIDBAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Resets the cached DB promise so the next openDB() call starts fresh.
 * Intended for use in unit tests only — do not call in production code.
 *
 * @internal
 */
export function _resetDBPromiseForTest(): void {
  _dbPromise = null;
}
