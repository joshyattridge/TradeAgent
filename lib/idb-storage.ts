/** Minimal IndexedDB key-value storage for zustand persist (avoids localStorage 5MB quota). */

const DB_NAME = "tradeagent-idb";
const STORE_NAME = "kv";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function idbGet(key: string): Promise<string | null> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => {
          const v = req.result;
          resolve(typeof v === "string" ? v : v == null ? null : String(v));
        };
        req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
      }),
  );
}

function idbSet(key: string, value: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB set failed"));
      }),
  );
}

function idbDel(key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
      }),
  );
}

/** Zustand `StateStorage`-compatible async storage backed by IndexedDB. */
export const idbStorage = {
  getItem: (name: string) => idbGet(name),
  setItem: (name: string, value: string) => idbSet(name, value),
  removeItem: (name: string) => idbDel(name),
};

const LEGACY_LS_KEY = "tradeagent-store-v3";

/**
 * One-time: copy bloated localStorage persist payload into IndexedDB, then clear LS.
 * Safe to call multiple times.
 */
export async function migrateLegacyLocalStorageToIdb(
  idbKey: string,
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const existing = await idbGet(idbKey);
    if (existing) {
      // Already on IDB — still clear leftover LS if present
      try {
        window.localStorage.removeItem(LEGACY_LS_KEY);
      } catch {
        // ignore
      }
      return;
    }
    const legacy = window.localStorage.getItem(LEGACY_LS_KEY);
    if (!legacy) return;
    await idbSet(idbKey, legacy);
    window.localStorage.removeItem(LEGACY_LS_KEY);
  } catch {
    // If migration fails, leave LS alone so rehydrate can still try elsewhere
  }
}

/** Best-effort: wipe legacy localStorage key if it's causing QuotaExceededError. */
export function clearLegacyLocalStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_LS_KEY);
  } catch {
    // ignore
  }
}
