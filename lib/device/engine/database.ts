/**
 * Device database wrapper (W1).
 *
 * A thin, explicit layer over a sqlite-wasm OO1 `Database`. It exists for three
 * reasons:
 *
 * 1. Drizzle's sqlite-proxy driver wants promises and rows-as-arrays. The OO1
 *    API is synchronous and returns rows as arrays already, so this is mostly a
 *    matter of wrapping.
 *
 * 2. Atomicity. Every request from every tab shares one connection, so an
 *    interactive transaction (BEGIN here, COMMIT somewhere else) could swallow
 *    another caller's statements. `batch()` is therefore the ONLY way to run a
 *    multi-statement change atomically, and the single-statement helpers reject
 *    transaction-control SQL outright.
 *
 * 3. Portability. This file must run in a browser Worker and in Node. It must
 *    never import `node:*`, `fs`, `path` or better-sqlite3.
 *
 * The `DbEngine` type is the subset of sqlite-wasm's `Database` we rely on, so
 * the wrapper can be unit-tested against a fake as well as the real thing.
 */

/** The subset of the sqlite-wasm OO1 Database API this wrapper uses. */
export interface DbEngine {
  exec(sql: string, opts?: { bind?: SqlBindValue[]; saveSql?: string[] }): unknown;
  selectArrays(sql: string, bind?: SqlBindValue[]): SqlRow[][];
  selectValue(sql: string, bind?: SqlBindValue[]): SqlValue | undefined;
  changes(): number;
  close(): void;
  readonly pointer?: number;
}

export type SqlValue = string | number | null | bigint | Uint8Array | Int8Array | ArrayBuffer;
/** A single bound parameter. Blobs and booleans are normalised before binding. */
export type SqlBindValue = SqlValue | boolean | undefined;
/** One row, in column order. */
export type SqlRow = SqlValue;
/** The method drizzle's sqlite-proxy driver asks for. */
export type SqlMethod = "run" | "all" | "get" | "values";

export interface BatchStatement {
  sql: string;
  params?: readonly SqlBindValue[];
  method: SqlMethod;
}

export interface BatchResult {
  rows: SqlValue[];
  changes: number;
}

export class DeviceSqlError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "DeviceSqlError";
  }
}

const TRANSACTION_CONTROL =
  /^\s*(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|PRAGMA\s+writable_schema)\b/i;

/**
 * Reject transaction control in single-statement helpers.
 *
 * Reason: one connection is shared by every caller in the tab (and, through the
 * leader, by every tab). A bare BEGIN would leave the connection inside an open
 * transaction and the next unrelated writer would silently join it. Use
 * `batch()` when a change must be atomic.
 */
export function assertNotTransactionControl(sql: string): void {
  if (TRANSACTION_CONTROL.test(sql)) {
    throw new DeviceSqlError(
      "Transaction control is not allowed here. Use batch() for atomic multi-statement changes."
    );
  }
}

/**
 * Normalise bound parameters, returning undefined when there are none.
 *
 * sqlite-wasm throws "This statement has no bindable parameters" if an EMPTY
 * array is bound to a statement that takes no parameters, so an absent bind has
 * to stay absent rather than becoming an empty list. Found by the engine check
 * suite on PRAGMA quick_check.
 */
function normaliseParams(params?: readonly SqlBindValue[]): SqlBindValue[] | undefined {
  if (!params || params.length === 0) return undefined;
  return params.map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : value));
}

/** Options for exec(), omitting `bind` entirely when there is nothing to bind. */
function bindOptions(params?: readonly SqlBindValue[]): { bind?: SqlBindValue[] } {
  const bind = normaliseParams(params);
  return bind === undefined ? {} : { bind };
}

function coerceBlob(values: SqlValue[]): SqlValue[] {
  return values.map((value) => {
    // sqlite-wasm may hand back a plain ArrayBuffer for BLOB columns; Drizzle's
    // blob mapper expects something with a byteLength it can wrap.
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return value;
  });
}

export class DeviceDatabase {
  constructor(private readonly engine: DbEngine) {}

  /** Apply the pragmas this app relies on. Called once, right after opening. */
  configure(): void {
    this.engine.exec("PRAGMA foreign_keys = ON");
    this.engine.exec("PRAGMA secure_delete = ON");
  }

  /** Raw handle, for callers that need sqlite-wasm features we do not wrap. */
  get raw(): DbEngine {
    return this.engine;
  }

  /** Execute a statement for its side effects. */
  run(sql: string, params?: readonly SqlBindValue[]): { changes: number } {
    assertNotTransactionControl(sql);
    this.engine.exec(sql, bindOptions(params));
    return { changes: this.engine.changes() };
  }

  /** Execute a query and return every row as an array. */
  all(sql: string, params?: readonly SqlBindValue[]): SqlValue[][] {
    return this.engine.selectArrays(sql, normaliseParams(params)).map(coerceBlob);
  }

  /** Execute a query and return the first row, or undefined. */
  get(sql: string, params?: readonly SqlBindValue[]): SqlValue[] | undefined {
    const rows = this.engine.selectArrays(sql, normaliseParams(params));
    const first = rows[0];
    return first ? coerceBlob(first) : undefined;
  }

  /** Execute a query and return the first two-hundred rows, as arrays. */
  values(sql: string, params?: readonly SqlBindValue[]): SqlValue[][] {
    return this.all(sql, params);
  }

  /**
   * Execute a scalar query. Used for quick_check and similar.
   */
  scalar(sql: string, params?: readonly SqlBindValue[]): SqlValue | undefined {
    return this.engine.selectValue(sql, normaliseParams(params));
  }

  /**
   * Run several statements as one atomic unit.
   *
   * BEGIN IMMEDIATE takes the write lock up front rather than upgrading later,
   * which avoids a "cannot start a transaction within a transaction" surprise
   * when two writers overlap on the single shared connection. Any error rolls
   * the whole batch back and is rethrown.
   */
  batch(statements: readonly BatchStatement[]): BatchResult[] {
    if (statements.length === 0) return [];
    const results: BatchResult[] = [];
    this.engine.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of statements) {
        const bind = normaliseParams(statement.params);
        if (statement.method === "run") {
          this.engine.exec(statement.sql, bindOptions(statement.params));
          results.push({ rows: [], changes: this.engine.changes() });
          continue;
        }
        const rows = this.engine.selectArrays(statement.sql, bind).map(coerceBlob);
        if (statement.method === "get") {
          results.push({ rows: (rows[0] ?? []) as SqlValue[], changes: 0 });
          continue;
        }
        for (const row of rows) results.push({ rows: row, changes: 0 });
        if (rows.length === 0) results.push({ rows: [], changes: 0 });
      }
      this.engine.exec("COMMIT");
      return results;
    } catch (error) {
      try {
        this.engine.exec("ROLLBACK");
      } catch {
        // A failed rollback means the connection is unusable; surface the
        // original error, which is the actionable one.
      }
      throw new DeviceSqlError("Batch failed and was rolled back.", error);
    }
  }

  /** PRAGMA quick_check. "ok" means the file is structurally sound. */
  quickCheck(): string {
    const value = this.scalar("PRAGMA quick_check");
    return typeof value === "string" ? value : String(value ?? "");
  }

  /** Foreign-key violations currently present. Empty array means clean. */
  foreignKeyViolations(): SqlValue[][] {
    return this.all("PRAGMA foreign_key_check");
  }

  /** Table names in the main schema, excluding SQLite's internal tables. */
  tableNames(): string[] {
    return this.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).map((row) => String(row[0]));
  }

  close(): void {
    this.engine.close();
  }
}