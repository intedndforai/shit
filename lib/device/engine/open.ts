/**
 * Opening the device database (W1).
 *
 * Two engines, one schema. Which one is available depends on the browser:
 *
 *   - "opfs": the official sqlite-wasm `opfs-sahpool` VFS. SQLite documents this
 *     VFS for clients that cannot set COOP/COEP headers, which is exactly our
 *     situation: cross-origin isolation would break the isolated preview origin,
 *     and Safari does not implement COEP `credentialless`. It is also the
 *     highest-throughput OPFS option. Its one real cost is that the pool of sync
 *     access handles can only be held by ONE context at a time, so a second tab
 *     cannot install it - the leader/follower arrangement in the worker is what
 *     makes multi-tab work, and it is not optional.
 *
 *   - "memory": a plain in-memory database. Used in Node (tests), and in any
 *     browser where opfs-sahpool is unavailable or fails to install. The caller
 *     is responsible for persisting it (see the worker's IndexedDB snapshot
 *     path) and for telling the user which engine is in use.
 *
 * The engine is deliberately NOT chosen silently. `kind` and `fallbackReason`
 * are returned so the UI can state what actually happened, and so a profile that
 * has already stored data in one engine is never quietly switched to another.
 *
 * This file must stay browser-safe: no `node:*`, `fs`, `path`, or
 * better-sqlite3. The package resolves to its own Node build in Node.
 */

import sqlite3InitModule, { type SAHPoolUtil, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { DeviceDatabase, type DbEngine } from "./database";

/** Where the database actually lives right now. */
export type DeviceEngineKind = "opfs" | "memory";

export interface DeviceCapabilities {
  /** Running inside a Worker (required for OPFS sync access handles). */
  worker: boolean;
  /** Running in a browser at all. */
  browser: boolean;
  /** navigator.storage.getDirectory() is available. */
  opfs: boolean;
  /** FileSystemSyncAccessHandle exists, so an OPFS-backed VFS can install. */
  syncAccessHandle: boolean;
  /** Web Locks are available, so a single writer can be elected across tabs. */
  webLocks: boolean;
  /** IndexedDB is available, so the memory engine can be persisted. */
  indexedDb: boolean;
  /** navigator.storage.persist() is callable (not available in Workers). */
  persist: boolean;
}

export interface DeviceOpenOptions {
  /** Try the OPFS engine first (default true). Set false to force memory. */
  preferOpfs?: boolean;
  /** OPFS directory for the VFS. Changing it orphans existing databases. */
  directoryName?: string;
  /**
   * Pool capacity. SQLite's guidance is at least twice the number of expected
   * database files (journals included), higher depending on TEMP_STORE.
   */
  initialCapacity?: number;
  /** Optional progress callback, for a first-run install that takes a moment. */
  onProgress?: (message: string) => void;
}

export interface DeviceOpenResult {
  db: DeviceDatabase;
  kind: DeviceEngineKind;
  /** Why the OPFS engine was not used, when it was not. Human-readable. */
  fallbackReason: string | null;
  sqlite3: Sqlite3Static;
  capabilities: DeviceCapabilities;
  /** The OPFS pool handle, when the OPFS engine is in use. */
  pool: SAHPoolUtil | null;
  /** Serialise the whole database. Used for snapshots and export. */
  snapshot(): Uint8Array;
  close(): void;
}

export class DeviceEngineError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "DeviceEngineError";
  }
}

/** Feature-detect without assuming a DOM. Safe to call on the server. */
export function detectCapabilities(): DeviceCapabilities {
  const g = globalThis as unknown as {
    navigator?: { storage?: { getDirectory?: unknown; persist?: unknown }; locks?: unknown };
    indexedDB?: unknown;
    FileSystemSyncAccessHandle?: unknown;
    WorkerGlobalScope?: unknown;
    document?: unknown;
  };
  const worker = typeof g.WorkerGlobalScope !== "undefined" && g.document === undefined;
  const browser = typeof g.document !== "undefined" || worker;
  return {
    worker,
    browser,
    opfs: typeof g.navigator?.storage?.getDirectory === "function",
    syncAccessHandle: typeof g.FileSystemSyncAccessHandle !== "undefined",
    webLocks: typeof g.navigator?.locks === "object" && g.navigator?.locks !== null,
    indexedDb: typeof g.indexedDB !== "undefined",
    persist: typeof g.navigator?.storage?.persist === "function",
  };
}

export const DEFAULT_OPFS_DIRECTORY = "/conduit-db";

/**
 * Load the wasm module. Cheap to call repeatedly: sqlite-wasm caches its own
 * instance on globalThis, so the module is fetched and compiled once per realm.
 */
export async function initSqlite(): Promise<Sqlite3Static> {
  try {
    return await sqlite3InitModule();
  } catch (error) {
    throw new DeviceEngineError("SQLite could not be initialised in this context.", error);
  }
}

/** Serialise a database through the wasm binding. */
export function exportDatabase(sqlite3: Sqlite3Static, db: DeviceDatabase): Uint8Array {
  const pointer = (db.raw as { pointer?: number }).pointer;
  if (!pointer) throw new DeviceEngineError("The database handle has no pointer to export.");
  return sqlite3.capi.sqlite3_js_db_export(pointer);
}

/**
 * Open an in-memory database from raw file bytes.
 *
 * SQLITE_DESERIALIZE_FREEONCLOSE hands ownership of the buffer to SQLite, which
 * frees it when the database closes; RESIZEABLE lets the database grow past the
 * imported size. Both are required: without RESIZEABLE the first write that
 * grows the file fails, and without FREEONCLOSE the buffer leaks.
 */
export function deserializeInto(db: DeviceDatabase, sqlite3: Sqlite3Static, bytes: Uint8Array): void {
  const capi = sqlite3.capi;
  const pointer = (db.raw as { pointer?: number }).pointer;
  if (!pointer) throw new DeviceEngineError("The database handle has no pointer to deserialize into.");
  const buffer = sqlite3.wasm.allocFromTypedArray(bytes);
  const flags = capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE;
  const rc = capi.sqlite3_deserialize(pointer, "main", buffer, bytes.byteLength, bytes.byteLength, flags);
  if (rc !== capi.SQLITE_OK) {
    throw new DeviceEngineError(`sqlite3_deserialize failed with code ${rc}.`);
  }
}

function wrap(sqlite3: Sqlite3Static, engine: unknown): DeviceDatabase {
  // sqlite-wasm's Database.exec has an overload set far wider than the subset we
  // use, so it is not structurally assignable to our narrow DbEngine on its own.
  // The cast is deliberate and the subset is asserted by the engine check suite,
  // which exercises every method through the real wasm build.
  const db = new DeviceDatabase(engine as DbEngine);
  void sqlite3;
  return db;
}

/** Open a fresh in-memory database. */
export async function openMemoryDatabase(): Promise<DeviceOpenResult> {
  const sqlite3 = await initSqlite();
  const engine = new sqlite3.oo1.DB(":memory:", "c");
  const db = wrap(sqlite3, engine);
  db.configure();
  return {
    db,
    kind: "memory",
    fallbackReason: null,
    sqlite3,
    capabilities: detectCapabilities(),
    pool: null,
    snapshot: () => exportDatabase(sqlite3, db),
    close: () => db.close(),
  };
}

/**
 * Open the database, preferring the OPFS engine when it can work.
 *
 * A failure to install the OPFS VFS is reported, never hidden: the caller
 * decides whether that is acceptable (first run) or fatal (a profile that
 * already has data in OPFS must not silently start over in memory).
 */
export async function openDeviceDatabase(options: DeviceOpenOptions = {}): Promise<DeviceOpenResult> {
  const capabilities = detectCapabilities();
  const preferOpfs = options.preferOpfs !== false;

  if (!preferOpfs) {
    const memory = await openMemoryDatabase();
    return { ...memory, capabilities, fallbackReason: "OPFS disabled by request." };
  }

  if (!capabilities.browser || !capabilities.worker || !capabilities.syncAccessHandle) {
    const memory = await openMemoryDatabase();
    const reason = capabilities.worker
      ? "This browser does not provide OPFS sync access handles."
      : "The database engine must run in a Worker to use OPFS.";
    return { ...memory, capabilities, fallbackReason: reason };
  }

  const sqlite3 = await initSqlite();
  try {
    options.onProgress?.("Installing the on-device database engine (first run only).");
    const pool = await sqlite3.installOpfsSAHPoolVfs({
      name: "opfs-sahpool",
      directory: options.directoryName ?? DEFAULT_OPFS_DIRECTORY,
      initialCapacity: options.initialCapacity ?? 6,
    });
    const engine = new pool.OpfsSAHPoolDb("/conduit.db");
    const db = wrap(sqlite3, engine);
    db.configure();
    return {
      db,
      kind: "opfs",
      fallbackReason: null,
      sqlite3,
      capabilities,
      pool,
      snapshot: () => exportDatabase(sqlite3, db),
      close: () => db.close(),
    };
  } catch (error) {
    const memory = await openMemoryDatabase();
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...memory,
      capabilities,
      fallbackReason: `The on-device database engine could not start (${message}).`,
    };
  }
}

/** Open an in-memory database preloaded with a serialised database. */
export async function openDatabaseFromBytes(bytes: Uint8Array): Promise<DeviceOpenResult> {
  const sqlite3 = await initSqlite();
  const engine = new sqlite3.oo1.DB(":memory:", "c");
  const db = wrap(sqlite3, engine);
  deserializeInto(db, sqlite3, bytes);
  db.configure();
  return {
    db,
    kind: "memory",
    fallbackReason: null,
    sqlite3,
    capabilities: detectCapabilities(),
    pool: null,
    snapshot: () => exportDatabase(sqlite3, db),
    close: () => db.close(),
  };
}
