/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLegacyLocalStorage,
  idbStorage,
  migrateLegacyLocalStorageToIdb,
} from "@/lib/idb-storage";

const LEGACY_LS_KEY = "tradeagent-store-v3";
const DB_NAME = "tradeagent-idb";
const STORE_NAME = "kv";

describe("idbStorage", () => {
  beforeEach(async () => {
    localStorage.clear();
    await idbStorage.removeItem("test-key");
    await idbStorage.removeItem("num-key");
    await idbStorage.removeItem("migrate-key");
  });

  it("round-trips string values via get/set/remove", async () => {
    expect(await idbStorage.getItem("test-key")).toBeNull();
    await idbStorage.setItem("test-key", '{"hello":"world"}');
    expect(await idbStorage.getItem("test-key")).toBe('{"hello":"world"}');
    await idbStorage.removeItem("test-key");
    expect(await idbStorage.getItem("test-key")).toBeNull();
  });

  it("coerces non-string IndexedDB values to String on get", async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(42, "num-key");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error("tx failed"));
      };
      req.onerror = () => reject(req.error ?? new Error("open failed"));
    });

    expect(await idbStorage.getItem("num-key")).toBe("42");
  });

  it("returns null for explicitly stored null values", async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(null, "null-key");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error("tx failed"));
      };
      req.onerror = () => reject(req.error ?? new Error("open failed"));
    });
    expect(await idbStorage.getItem("null-key")).toBeNull();
  });
});

describe("migrateLegacyLocalStorageToIdb", () => {
  beforeEach(async () => {
    localStorage.clear();
    await idbStorage.removeItem("migrate-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns early when window is undefined (SSR)", async () => {
    const win = global.window;
    // @ts-expect-error simulate SSR
    delete global.window;
    await expect(
      migrateLegacyLocalStorageToIdb("migrate-key"),
    ).resolves.toBeUndefined();
    global.window = win;
  });

  it("does nothing when there is no legacy localStorage payload", async () => {
    await migrateLegacyLocalStorageToIdb("migrate-key");
    expect(await idbStorage.getItem("migrate-key")).toBeNull();
  });

  it("copies legacy localStorage into IndexedDB and clears LS", async () => {
    localStorage.setItem(LEGACY_LS_KEY, '{"legacy":true}');
    await migrateLegacyLocalStorageToIdb("migrate-key");
    expect(await idbStorage.getItem("migrate-key")).toBe('{"legacy":true}');
    expect(localStorage.getItem(LEGACY_LS_KEY)).toBeNull();
  });

  it("clears leftover LS when IDB already has data", async () => {
    await idbStorage.setItem("migrate-key", '{"already":"idb"}');
    localStorage.setItem(LEGACY_LS_KEY, '{"stale":true}');
    await migrateLegacyLocalStorageToIdb("migrate-key");
    expect(await idbStorage.getItem("migrate-key")).toBe('{"already":"idb"}');
    expect(localStorage.getItem(LEGACY_LS_KEY)).toBeNull();
  });

  it("ignores LS remove errors when IDB already has data", async () => {
    await idbStorage.setItem("migrate-key", '{"already":"idb"}');
    localStorage.setItem(LEGACY_LS_KEY, '{"stale":true}');
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await expect(
      migrateLegacyLocalStorageToIdb("migrate-key"),
    ).resolves.toBeUndefined();
  });

  it("leaves LS alone when migration throws", async () => {
    localStorage.setItem(LEGACY_LS_KEY, '{"legacy":true}');
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
      if (key === LEGACY_LS_KEY) throw new Error("blocked");
      return null;
    });
    await migrateLegacyLocalStorageToIdb("migrate-key");
    vi.restoreAllMocks();
    expect(localStorage.getItem(LEGACY_LS_KEY)).toBe('{"legacy":true}');
    expect(await idbStorage.getItem("migrate-key")).toBeNull();
  });
});

describe("clearLegacyLocalStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns early when window is undefined (SSR)", () => {
    const win = global.window;
    // @ts-expect-error simulate SSR
    delete global.window;
    expect(() => clearLegacyLocalStorage()).not.toThrow();
    global.window = win;
  });

  it("removes the legacy key when present", () => {
    localStorage.setItem(LEGACY_LS_KEY, "bloated");
    clearLegacyLocalStorage();
    expect(localStorage.getItem(LEGACY_LS_KEY)).toBeNull();
  });

  it("ignores removeItem errors", () => {
    localStorage.setItem(LEGACY_LS_KEY, "bloated");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => clearLegacyLocalStorage()).not.toThrow();
  });
});

describe("idb internal error handlers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips createObjectStore when the kv store already exists on upgrade", async () => {
    const createObjectStore = vi.fn();
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const req = {
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore,
          transaction: () => {
            const tx = {
              objectStore: () => ({
                put: () => ({}),
                get: () => {
                  const getReq = { result: "value" } as IDBRequest;
                  queueMicrotask(() =>
                    (getReq as IDBRequest & { onsuccess?: (e: Event) => void }).onsuccess?.(
                      { target: getReq } as Event,
                    ),
                  );
                  return getReq;
                },
              }),
              oncomplete: null as ((e: Event) => void) | null,
              onerror: null as ((e: Event) => void) | null,
            };
            queueMicrotask(() => tx.oncomplete?.({} as Event));
            return tx;
          },
        },
        onupgradeneeded: null as ((e: IDBVersionChangeEvent) => void) | null,
        onsuccess: null as ((e: Event) => void) | null,
        onerror: null as ((e: Event) => void) | null,
        error: null,
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => {
        req.onupgradeneeded?.({ target: req } as unknown as IDBVersionChangeEvent);
        req.onsuccess?.({ target: req } as Event);
      });
      return req;
    });

    await idbStorage.setItem("upgrade-skip-key", "value");
    expect(createObjectStore).not.toHaveBeenCalled();
    expect(await idbStorage.getItem("upgrade-skip-key")).toBe("value");
  });

  it("rejects when IndexedDB open fails", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const req = {
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
        onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
        error: null,
      } as IDBOpenDBRequest;
      queueMicrotask(() => req.onerror?.({ target: req } as Event));
      return req;
    });
    await expect(idbStorage.getItem("fail-open")).rejects.toThrow("IndexedDB open failed");
  });

  it("rejects when IndexedDB get transaction fails without error detail", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const req = {
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
        onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
        result: {
          transaction: () => ({
            objectStore: () => ({
              get: () => {
                const getReq = {
                  onsuccess: null as ((ev: Event) => void) | null,
                  onerror: null as ((ev: Event) => void) | null,
                  error: null,
                } as IDBRequest;
                queueMicrotask(() => getReq.onerror?.({ target: getReq } as Event));
                return getReq;
              },
            }),
          }),
          objectStoreNames: { contains: () => true },
        },
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => req.onsuccess?.({ target: req } as Event));
      return req;
    });
    await expect(idbStorage.getItem("fail-get")).rejects.toThrow("IndexedDB get failed");
  });

  it("rejects when IndexedDB set transaction fails without error detail", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const req = {
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
        onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
        result: {
          transaction: () => {
            const tx = {
              objectStore: () => ({ put: () => undefined }),
              oncomplete: null as ((ev: Event) => void) | null,
              onerror: null as ((ev: Event) => void) | null,
              error: null,
            } as IDBTransaction;
            queueMicrotask(() => tx.onerror?.({ target: tx } as Event));
            return tx;
          },
          objectStoreNames: { contains: () => true },
        },
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => req.onsuccess?.({ target: req } as Event));
      return req;
    });
    await expect(idbStorage.setItem("fail-set", "x")).rejects.toThrow("IndexedDB set failed");
  });

  it("rejects when IndexedDB delete transaction fails without error detail", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const req = {
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
        onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
        result: {
          transaction: () => {
            const tx = {
              objectStore: () => ({ delete: () => undefined }),
              oncomplete: null as ((ev: Event) => void) | null,
              onerror: null as ((ev: Event) => void) | null,
              error: null,
            } as IDBTransaction;
            queueMicrotask(() => tx.onerror?.({ target: tx } as Event));
            return tx;
          },
          objectStoreNames: { contains: () => true },
        },
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => req.onsuccess?.({ target: req } as Event));
      return req;
    });
    await expect(idbStorage.removeItem("fail-del")).rejects.toThrow(
      "IndexedDB delete failed",
    );
  });

  it("rejects when IndexedDB open fails with explicit error", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const req = {
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
        onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
        error: new DOMException("open failed"),
      } as IDBOpenDBRequest;
      queueMicrotask(() => req.onerror?.({ target: req } as Event));
      return req;
    });
    await expect(idbStorage.getItem("fail-open")).rejects.toThrow();
  });

  it("rejects when IndexedDB get transaction fails", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const req = {
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
        onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
        result: {
          transaction: () => ({
            objectStore: () => ({
              get: () => {
                const getReq = {
                  onsuccess: null as ((ev: Event) => void) | null,
                  onerror: null as ((ev: Event) => void) | null,
                } as IDBRequest;
                queueMicrotask(() => getReq.onerror?.({ target: getReq } as Event));
                return getReq;
              },
            }),
          }),
          objectStoreNames: { contains: () => true },
        },
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => req.onsuccess?.({ target: req } as Event));
      return req;
    });
    await expect(idbStorage.getItem("fail-get")).rejects.toBeTruthy();
  });

  it("rejects when IndexedDB set transaction fails", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const req = {
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
        onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
        result: {
          transaction: () => {
            const tx = {
              objectStore: () => ({ put: () => undefined }),
              oncomplete: null as ((ev: Event) => void) | null,
              onerror: null as ((ev: Event) => void) | null,
              error: new DOMException("set failed"),
            } as IDBTransaction;
            queueMicrotask(() => tx.onerror?.({ target: tx } as Event));
            return tx;
          },
          objectStoreNames: { contains: () => true },
        },
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => req.onsuccess?.({ target: req } as Event));
      return req;
    });
    await expect(idbStorage.setItem("fail-set", "x")).rejects.toBeTruthy();
  });

  it("rejects when IndexedDB delete transaction fails", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const req = {
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
        onupgradeneeded: null as ((ev: Event) => void) | null,
        result: {
          transaction: () => {
            const tx = {
              objectStore: () => ({ delete: () => undefined }),
              oncomplete: null as ((ev: Event) => void) | null,
              onerror: null as ((ev: Event) => void) | null,
              error: new DOMException("delete failed"),
            } as IDBTransaction;
            queueMicrotask(() => tx.onerror?.({ target: tx } as Event));
            return tx;
          },
          objectStoreNames: { contains: () => true },
        },
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => req.onsuccess?.({ target: req } as Event));
      return req;
    });
    await expect(idbStorage.removeItem("fail-del")).rejects.toBeTruthy();
  });
});
