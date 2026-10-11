import path from "node:path";
import fs from "node:fs";
import { sql } from "drizzle-orm";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  __conduitDb?: BetterSQLite3Database<typeof schema>;
};

function resolveSqlitePath(): string {
  const configured = process.env.SQLITE_PATH?.trim();
  if (!configured || configured === ":memory:") {
    return configured === ":memory:" ? ":memory:" : path.join(process.cwd(), "data", "conduit.db");
  }
  // SQLITE_PATH is user-configurable at runtime, so the path is intentionally dynamic.
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

function createDb(): BetterSQLite3Database<typeof schema> {
  const sqlitePath = resolveSqlitePath();
  if (sqlitePath !== ":memory:") {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  }

  const sqlite = new Database(sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  // Apply generated migrations if present (created via `npm run db:generate`).
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (fs.existsSync(migrationsFolder)) {
    migrate(db, { migrationsFolder });
  }

  return db;
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!globalForDb.__conduitDb) {
    globalForDb.__conduitDb = createDb();
  }
  return globalForDb.__conduitDb;
}

export function dbHealth(): { ok: boolean; path: string } {
  try {
    const row = getDb().get<{ n: number }>(sql`select 1 as n`);
    return { ok: row?.n === 1, path: resolveSqlitePath() };
  } catch {
    return { ok: false, path: resolveSqlitePath() };
  }
}

export { schema };