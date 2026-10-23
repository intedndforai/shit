/**
 * The RPC contract between the UI and the device database Worker (W1).
 *
 * Pure data types and constants only. Importing this file must never pull
 * sqlite-wasm (or anything else heavy) into the main-thread bundle, so the one
 * import below is `import type` - erased at compile time.
 *
 * Two conversations use these shapes:
 *
 *   - main thread <-> its own Worker: DeviceRpcRequest / DeviceRpcResponse,
 *     correlated by `id`.
 *   - Worker <-> Worker over a BroadcastChannel, when this tab is not the one
 *     holding the database: DeviceWireMessage. The leader answers requests from
 *     followers; followers never open the database themselves.
 */

import type { DeviceCapabilities } from "./engine/open";

/** Which engine is actually backing the database. */
export type DeviceEngineName = "opfs" | "memory";

/** A parameter that can cross a postMessage boundary. */
export type DeviceParam = string | number | null | boolean | Uint8Array;

export interface DeviceStatement {
  sql: string;
  params: readonly DeviceParam[];
  method: "run" | "all" | "get" | "values";
}

export interface DeviceStatementResult {
  rows: unknown[];
  changes?: number;
}

export type DeviceOp =
  | { op: "status" }
  | { op: "migrate" }
  | { op: "exec"; statement: DeviceStatement }
  | { op: "batch"; statements: readonly DeviceStatement[] }
  | { op: "snapshot" }
  | { op: "import"; bytes: Uint8Array }
  | { op: "wipe" };

export interface DeviceRpcRequest {
  v: 1;
  id: string;
  op: DeviceOp;
}

export interface DeviceRpcSuccess {
  v: 1;
  id: string;
  ok: true;
  result: unknown;
}

export interface DeviceRpcFailure {
  v: 1;
  id: string;
  ok: false;
  error: string;
  /** Optional machine-readable code so the UI can react (e.g. SCHEMA_TOO_NEW). */
  code?: string;
}

export type DeviceRpcResponse = DeviceRpcSuccess | DeviceRpcFailure;

/** A follower asking the leader to run an operation. */
export interface DeviceWireRequest {
  v: 1;
  kind: "req";
  from: string;
  id: string;
  op: DeviceOp;
}

/** The leader's answer to a follower. */
export interface DeviceWireResponse {
  v: 1;
  kind: "res";
  to: string;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: string;
}

export type DeviceWireMessage = DeviceWireRequest | DeviceWireResponse;

/** Status the UI can honestly display. */
export interface DeviceWorkerStatus {
  ready: boolean;
  role: "starting" | "leader" | "follower";
  /** Null until an engine has been opened. */
  engine: DeviceEngineName | null;
  /**
   * Set when the engine this profile is pinned to could not start. The app must
   * surface this and must NOT fall back to another engine: a silent switch would
   * look like data loss.
   */
  engineError: string | null;
  /** Why the first-run choice landed on the memory engine, when it did. */
  fallbackReason: string | null;
  capabilities: DeviceCapabilities;
  /** Where the bytes actually live right now. */
  persisted: "opfs" | "indexeddb" | "none";
  /** created_at of the newest applied migration, or null. */
  schemaVersion: number | null;
  /** Migration tags still to apply. */
  pendingMigrations: string[];
  /** When the memory engine last wrote a snapshot to IndexedDB. */
  lastPersistedAt: number | null;
  /** True when the database is explicitly temporary (Incognito). */
  ephemeral: boolean;
}

export const DEVICE_WIRE_VERSION = 1;
export const DEVICE_CHANNEL_NAME = "conduit-device-db";
export const DEVICE_LEADER_LOCK = "conduit-device-db-leader";

/** Absolute path of the database file inside the OPFS pool. */
export const DEVICE_DB_FILENAME = "/conduit.db";

/**
 * How long a follower waits for the leader's answer before giving up. The
 * caller retries, which is what makes a leader hand-off survivable: for a moment
 * during hand-off there is no leader listening.
 */
export const DEVICE_FORWARD_TIMEOUT_MS = 10_000;
