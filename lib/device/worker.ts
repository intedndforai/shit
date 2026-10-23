/// <reference lib="webworker" />
/**
 * The device database Worker (W1).
 *
 * One Worker per tab. Exactly one of them owns the database at a time, decided
 * by a Web Lock, because the OPFS sync-access-handle pool cannot be shared
 * between contexts: SQLite's own documentation says only one instance may use a
 * given directory concurrently. So:
 *
 *   leader   holds DEVICE_LEADER_LOCK, opens the engine, runs every statement,
 *            and answers other tabs over a BroadcastChannel.
 *   follower does not touch the database at all; it forwards ops to the leader
 *            and waits (with a timeout) for the answer.
 *
 * When the leader's tab closes, the lock is released and the next tab's queued
 * request runs, so it becomes the new leader. During that hand-off there is
 * briefly no one listening, which is why the client retries: a bounded retry in
 * the client is a design requirement, not a nicety.
 *
 * Failures are surfaced, never hidden. If this profile is pinned to the OPFS
 * engine and OPFS will not start, the Worker reports `engineError` and serves
 * nothing, rather than quietly opening an empty in-memory database that would
 * look exactly like data loss.
 *
 * Durability rule for the memory engine: a mutation is acknowledged only after
 * the snapshot has been written to IndexedDB. For the OPFS engine durability is
 * the filesystem's job.
 */

import type { SqlMethod } from "./engine/database";
import { migrateDevice, latestApplied, pendingMigrations } from "./engine/migrator";
import { DEVICE_MIGRATIONS } from "./engine/migrations.generated";
import { openDatabaseFromBytes, openDeviceDatabase, type DeviceOpenResult } from "./engine/open";
import {
  idbClear,
  readEngineChoice,
  readSnapshot,
  writeEngineChoice,
  writeSnapshot,
} from "./idb";
import {
  DEVICE_CHANNEL_NAME,
  DEVICE_DB_FILENAME,
  DEVICE_FORWARD_TIMEOUT_MS,
  DEVICE_LEADER_LOCK,
  DEVICE_WIRE_VERSION,
  type DeviceOp,
  type DeviceRpcRequest,
  type DeviceRpcResponse,
  type DeviceStatement,
  type DeviceStatementResult,
  type DeviceWireMessage,
  type DeviceWireRequest,
  type DeviceWireResponse,
  type DeviceWorkerStatus,
} from "./protocol";

type Scope = DedicatedWorkerGlobalScope;
const scope = self as unknown as Scope;

const workerId = cryptoRandomId();

let opened: DeviceOpenResult | null = null;
let role: DeviceWorkerStatus["role"] = "starting";
let engineError: string | null = null;
let fallbackReason: string | null = null;
let lastPersistedAt: number | null = null;
let channel: BroadcastChannel | null = null;
let releaseLeadership: (() => void) | null = null;
let started: Promise<void> | null = null;
const pendingForward = new Map<string, { resolve: (response: DeviceWireResponse) => void }>();

function cryptoRandomId(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();
  return `w-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

function status(): DeviceWorkerStatus {
  const capabilities = opened?.capabilities ?? {
    worker: true,
    browser: true,
    opfs: false,
    syncAccessHandle: false,
    webLocks: typeof navigator !== "undefined" && Boolean(navigator.locks),
    indexedDb: typeof indexedDB !== "undefined",
    persist: false,
  };
  return {
    ready: opened !== null && engineError === null,
    role,
    engine: opened?.kind ?? null,
    engineError,
    fallbackReason,
    capabilities,
    persisted: opened ? (opened.kind === "opfs" ? "opfs" : "indexeddb") : "none",
    schemaVersion: opened ? (latestApplied(opened.db)?.createdAt ?? null) : null,
    pendingMigrations: opened ? pendingMigrations(opened.db, DEVICE_MIGRATIONS).map((m) => m.tag) : [],
    lastPersistedAt,
    ephemeral: false,
  };
}

function pushStatus(): void {
  scope.postMessage({ kind: "status", status: status() });
}

/* ------------------------------------------------------------------ */
/* Opening                                                             */
/* ------------------------------------------------------------------ */

/**
 * Open the engine, honouring the engine this profile already chose.
 *
 * A profile that has chosen "opfs" is never silently moved to "memory": if OPFS
 * cannot start, that is an error the user must see, because the alternative
 * would present an empty database as though the data had gone.
 */
async function openEngine(): Promise<void> {
  const choice = await readEngineChoice();

  if (choice === "opfs") {
    const result = await openDeviceDatabase({ preferOpfs: true });
    if (result.kind !== "opfs") {
      engineError =
        result.fallbackReason ??
        "The on-device database could not be opened, and this profile is pinned to it.";
      return;
    }
    opened = result;
    return;
  }

  if (choice === "memory") {
    const bytes = await readSnapshot();
    if (bytes && bytes.byteLength > 0) {
      try {
        opened = await openDatabaseFromBytes(bytes);
        return;
      } catch (error) {
        // A corrupt snapshot is a real failure: report it rather than starting
        // empty, so the user can decide what to do.
        engineError = `The saved device database could not be read: ${errorMessage(error)}`;
        return;
      }
    }
    opened = await openDeviceDatabase({ preferOpfs: false });
    return;
  }

  // First run: prefer OPFS, record whatever we get so later runs are pinned.
  const result = await openDeviceDatabase({ preferOpfs: true });
  opened = result;
  fallbackReason = result.fallbackReason;
  await writeEngineChoice(result.kind);
}

/** Bring the schema up to date. Idempotent. */
async function ensureMigrated(): Promise<void> {
  if (!opened) return;
  await migrateDevice(opened!.db, DEVICE_MIGRATIONS, {
    // Snapshot before a schema change, so a failed migration is recoverable.
    onBeforeMigrate: async () => {
      if (opened!.kind === "memory") await persistSnapshot();
    },
  });
  lastPersistedAt = Date.now();
}

/** Write the database image to IndexedDB. Memory engine only. */
async function persistSnapshot(): Promise<void> {
  if (!opened || opened.kind !== "memory") return;
  const bytes = opened.snapshot();
  await writeSnapshot(bytes);
  lastPersistedAt = Date.now();
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

function requireOpen(): DeviceOpenResult {
  if (engineError) throw new Error(engineError);
  if (!opened) throw new Error("The device database is not open.");
  return opened;
}

function normaliseMethod(method: DeviceStatement["method"]): SqlMethod {
  return method;
}

async function runOp(op: DeviceOp): Promise<unknown> {
  switch (op.op) {
    case "status":
      return status();

    case "migrate": {
      await ensureMigrated();
      return status();
    }

    case "exec": {
      const target = requireOpen();
      const { sql, params, method } = op.statement;
      const bound = params as never[];
      if (method === "run") {
        const result = target.db.run(sql, bound);
        if (target.kind === "memory") await persistSnapshot();
        return { rows: [], changes: result.changes } satisfies DeviceStatementResult;
      }
      if (method === "get") {
        const row = target.db.get(sql, bound);
        return { rows: (row ?? []) as unknown[] } satisfies DeviceStatementResult;
      }
      return { rows: target.db.all(sql, bound) as unknown[] } satisfies DeviceStatementResult;
    }

    case "batch": {
      const target = requireOpen();
      const results = target.db.batch(
        op.statements.map((statement) => ({
          sql: statement.sql,
          params: statement.params as never[],
          method: normaliseMethod(statement.method),
        }))
      );
      if (target.kind === "memory") await persistSnapshot();
      return results.map((result) => ({ rows: result.rows as unknown[], changes: result.changes }));
    }

    case "snapshot": {
      const target = requireOpen();
      return target.snapshot();
    }

    case "import": {
      const target = requireOpen();
      const bytes = op.bytes;
      if (target.kind === "opfs") {
        // The pool replaces the file contents wholesale. The VFS rewrites the
        // header to disable WAL on the way in, which is why the device never
        // runs in WAL mode.
        target.db.close();
        if (!target.pool) throw new Error("The OPFS pool is not available to import into.");
        await target.pool.importDb(DEVICE_DB_FILENAME, bytes);
        opened = await openDeviceDatabase({ preferOpfs: true });
        if (opened.kind !== "opfs") throw new Error("The database could not be reopened after import.");
      } else {
        target.db.close();
        opened = await openDatabaseFromBytes(bytes);
      }
      await ensureMigrated();
      await persistSnapshot();
      return status();
    }

    case "wipe": {
      const target = opened;
      opened = null;
      if (target) {
        try {
          target.db.close();
        } catch {
          // Already closed is fine.
        }
        if (target.pool) {
          try {
            await target.pool.wipeFiles();
          } catch {
            // Best effort; removeVfs below is the stronger action.
          }
          try {
            await target.pool.removeVfs();
          } catch {
            // The VFS may already be gone.
          }
        }
      }
      await idbClear();
      releaseLeadership?.();
      releaseLeadership = null;
      return { wiped: true };
    }

    default:
      throw new Error("Unknown device operation.");
  }
}

/* ------------------------------------------------------------------ */
/* Leader / follower                                                   */
/* ------------------------------------------------------------------ */

function ensureChannel(): BroadcastChannel {
  if (channel) return channel;
  channel = new BroadcastChannel(DEVICE_CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<DeviceWireMessage>) => {
    const message = event.data;
    if (!message || message.v !== DEVICE_WIRE_VERSION) return;

    if (message.kind === "req") {
      // Only the leader answers, and never its own broadcast.
      if (role !== "leader" || message.from === workerId) return;
      void (async () => {
        try {
          const result = await runOp(message.op);
          postWire({ v: 1, kind: "res", to: message.from, id: message.id, ok: true, result });
        } catch (error) {
          postWire({
            v: 1,
            kind: "res",
            to: message.from,
            id: message.id,
            ok: false,
            error: errorMessage(error),
          });
        }
      })();
      return;
    }

    if (message.kind === "res" && message.to === workerId) {
      const waiter = pendingForward.get(message.id);
      if (waiter) {
        pendingForward.delete(message.id);
        waiter.resolve(message);
      }
    }
  };
  return channel;
}

function postWire(message: DeviceWireMessage): void {
  ensureChannel().postMessage(message);
}

/** Ask the current leader to run an op on our behalf. */
async function forwardToLeader(op: DeviceOp): Promise<unknown> {
  const wire = ensureChannel();
  const id = cryptoRandomId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingForward.delete(id);
      reject(new Error("The tab holding the device database did not answer in time. Try again."));
    }, DEVICE_FORWARD_TIMEOUT_MS);
    pendingForward.set(id, {
      resolve: (response) => {
        clearTimeout(timer);
        if (response.ok) resolve(response.result);
        else reject(new Error(response.error ?? "The leader rejected the operation."));
      },
    });
    const request: DeviceWireRequest = { v: 1, kind: "req", from: workerId, id, op };
    wire.postMessage(request);
  });
}

/** Become the leader: open, migrate, and start answering followers. */
async function lead(): Promise<void> {
  role = "leader";
  ensureChannel();
  await openEngine();
  if (!engineError) await ensureMigrated();
  pushStatus();
}

async function start(): Promise<void> {
  ensureChannel();

  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) {
    // No Web Locks: a single tab can still work safely on its own. With several
    // tabs there is no way to elect a writer, so say so instead of risking two.
    await lead();
    engineError =
      engineError ??
      "This browser has no Web Locks API, so only one tab at a time can use the device database.";
    pushStatus();
    return;
  }

  // Fast path: take the lock if it is free.
  const acquired = await locks.request(DEVICE_LEADER_LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await lead();
    await new Promise<void>((resolve) => {
      releaseLeadership = resolve;
    });
    return true;
  });

  if (acquired) return;

  // Another tab owns it. Serve from here as a follower, and queue for the lock
  // so that we take over when that tab closes.
  role = "follower";
  pushStatus();
  void locks.request(DEVICE_LEADER_LOCK, { mode: "exclusive" }, async () => {
    await lead();
    await new Promise<void>((resolve) => {
      releaseLeadership = resolve;
    });
  });
}

/* ------------------------------------------------------------------ */
/* Main-thread RPC                                                     */
/* ------------------------------------------------------------------ */

function respond(response: DeviceRpcResponse): void {
  scope.postMessage(response);
}

scope.onmessage = (event: MessageEvent<DeviceRpcRequest>) => {
  const request = event.data;
  if (!request || request.v !== 1) return;
  void (async () => {
    try {
      if (!started) started = start();
      if (request.op.op !== "status" && request.op.op !== "wipe") {
        await started;
      }
      if (role === "follower") {
        const result = await forwardToLeader(request.op);
        respond({ v: 1, id: request.id, ok: true, result });
        return;
      }
      const result = await runOp(request.op);
      pushStatus();
      respond({ v: 1, id: request.id, ok: true, result });
    } catch (error) {
      respond({ v: 1, id: request.id, ok: false, error: errorMessage(error) });
    }
  })();
};


