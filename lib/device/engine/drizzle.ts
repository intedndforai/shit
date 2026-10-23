/**
 * Drizzle over the device database (W1).
 *
 * Drizzle talks to the device database through its documented sqlite-proxy
 * driver: an async callback that receives one statement and returns rows as
 * arrays. That shape is exactly what the Worker RPC boundary can carry, which is
 * why the executor is an interface rather than a direct call - the same
 * repository code then runs over a Worker port in the browser and over a direct
 * call in Node tests.
 *
 * Row-shape rules from drizzle's driver (drizzle-orm/sqlite-proxy/driver.d.ts):
 *   - `get`    returns a single row array, so `{ rows: row }`
 *   - `all`/`values` return an array of row arrays, so `{ rows: rows }`
 * Returning the wrong nesting here produces silently empty typed results, not an
 * error, so the engine check suite asserts real values come back.
 *
 * `batch` is wired to the database's atomic batch, which is the only way to run
 * a multi-statement change transactionally on the shared connection.
 */

import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "../../db/schema";
import type { SqlBindValue, SqlMethod, SqlValue } from "./database";

/** One statement as it crosses the executor boundary. */
export interface DeviceStatement {
  sql: string;
  params: readonly SqlBindValue[];
  method: SqlMethod;
}

/** One statement's result. `get` returns the row; others return rows. */
export interface DeviceStatementResult {
  rows: SqlValue[];
}

/**
 * Where statements are really executed. In the browser this is a Worker
 * message; in Node it is a direct call into the sqlite-wasm database.
 */
export interface DeviceExecutor {
  exec(statement: DeviceStatement): Promise<DeviceStatementResult>;
  batch(statements: readonly DeviceStatement[]): Promise<DeviceStatementResult[]>;
}

export type DeviceDrizzle = SqliteRemoteDatabase<typeof schema>;

/** The typed drizzle instance for the device database. */
export function createDeviceDrizzle(executor: DeviceExecutor): DeviceDrizzle {
  const single = async (
    sql: string,
    params: unknown[],
    method: "run" | "all" | "values" | "get"
  ): Promise<{ rows: unknown[] }> => {
    const result = await executor.exec({
      sql,
      params: (params ?? []) as SqlBindValue[],
      method,
    });
    // For `get`, drizzle expects the row itself; for the rest, the row list.
    return { rows: result.rows };
  };

  const batched = async (
    statements: { sql: string; params: unknown[]; method: "run" | "all" | "values" | "get" }[]
  ): Promise<{ rows: unknown[] }[]> => {
    const results = await executor.batch(
      statements.map((statement) => ({
        sql: statement.sql,
        params: (statement.params ?? []) as SqlBindValue[],
        method: statement.method,
      }))
    );
    return results.map((result) => ({ rows: result.rows }));
  };

  return drizzle(single, batched, { schema });
}
