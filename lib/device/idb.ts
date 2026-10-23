/**
 * The small IndexedDB store used by the device layer (W1).
 *
 * It holds exactly three kinds of item, all small:
 *
 *   - `engine`: which engine this profile is pinned to ("opfs" or "memory").
 *   - `snapshot`: the serialised database, written only by the memory engine.
 *   - `meta`: a little bookkeeping (last persisted time, schema version).
 *
 * Deliberately NOT stored here: file bytes. Attachments and project files belong
 * in OPFS, because IndexedDB is a poor place for large blobs and the snapshot has
 * to stay small enough to rewrite quickly.
 *
 * Runs in a Worker as well as on the main thread. No DOM APIs are used.
 */

const DB_NAME = "conduit-device";
const DB_VERSION = 1;
const STORE = "kv";

export type DeviceIdbKey = "engine" | "snapshot" | "meta";
export function openDeviceIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this context."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened."));
    request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another tab."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | null
): Promise<T | undefined> {
  const db = await openDeviceIdb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const store = transaction.objectStore(STORE);
      const request = run(store);
      let settled: T | undefined;
      if (request) {
        request.onsuccess = () => {
          settled = request.result as T;
        };
      }
      transaction.oncomplete = () => resolve(settled);
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    });
  } finally {
    db.close();
  }
}

export function idbGet<T>(key: DeviceIdbKey): Promise<T | undefined> {
  return withStore<T>("readonly", (store) => store.get(key) as IDBRequest<T>);
}

export async function idbSet(key: DeviceIdbKey, value: unknown): Promise<void> {
  await withStore("readwrite", (store) => store.put(value, key) as IDBRequest<IDBValidKey>);
}

export async function idbDelete(key: DeviceIdbKey): Promise<void> {
  await withStore("readwrite", (store) => store.delete(key) as IDBRequest<undefined>);
}

/** Remove every key. Used by "delete all local data" and before a wipe. */
export async function idbClear(): Promise<void> {
  await withStore("readwrite", (store) => store.clear() as IDBRequest<undefined>);
}

/** Persisted engine choice for this profile, or null on first run. */
export async function readEngineChoice(): Promise<"opfs" | "memory" | null> {
  const value = await idbGet<unknown>("engine");
  return value === "opfs" || value === "memory" ? value : null;
}

export function writeEngineChoice(engine: "opfs" | "memory"): Promise<void> {
  return idbSet("engine", engine);
}

/** The serialised database, as written by the memory engine. */
export async function readSnapshot(): Promise<Uint8Array | null> {
  const value = await idbGet<unknown>("snapshot");
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

export function writeSnapshot(bytes: Uint8Array): Promise<void> {
  return idbSet("snapshot", bytes);
}

export function deleteSnapshot(): Promise<void> {
  return idbDelete("snapshot");
}
