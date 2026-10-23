/**
 * Device engine checks (W1 step 2a). Run with `npm run device:check`.
 *
 * Proves the device database core against the REAL sqlite-wasm build, and proves
 * that a server database file and a device database file agree on schema and
 * migration bookkeeping. Follows the repo's existing check-script style
 * (see scripts/redact-check.ts): numbered checks, PASS/FAIL lines, total, and a
 * non-zero exit when anything fails.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

import { DeviceDatabase } from "../lib/device/engine/database";
import { createDeviceDrizzle } from "../lib/device/engine/drizzle";
import {
  migrateDevice,
  pendingMigrations,
  latestApplied,
  SchemaTooNewError,
  MIGRATIONS_TABLE,
} from "../lib/device/engine/migrator";
import { DEVICE_MIGRATIONS } from "../lib/device/engine/migrations.generated";
import { deserializeInto, exportDatabase } from "../lib/device/engine/open";
import * as schema from "../lib/db/schema";

let passed = 0;
let total = 0;

function check(name: string, condition: boolean, detail?: string): void {
  total += 1;
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

/** Open a fresh in-memory sqlite-wasm database without touching lib/device/open
 * (that module also probes browser capabilities; here we only need the engine). */
async function openMemory(): Promise<{
  sqlite3: Sqlite3Static;
  db: DeviceDatabase;
  /** Serialise THIS database with the instance that owns it. */
  snapshot: () => Uint8Array;
}> {
  const mod = await import("@sqlite.org/sqlite-wasm");
  const sqlite3 = await (mod.default as () => Promise<Sqlite3Static>)();
  const engine = new sqlite3.oo1.DB(":memory:", "c");
  const db = new DeviceDatabase(engine as never);
  db.configure();
  return { sqlite3, db, snapshot: () => exportDatabase(sqlite3, db) };
}

/** Tables declared in the drizzle schema, derived - not hardcoded. */
function declaredTables(): string[] {
  const names = new Set<string>();
  for (const value of Object.values(schema as Record<string, unknown>)) {
    // drizzle's own type guard, so only real table objects are counted: the
    // schema module also exports plain arrays and constants.
    if (is(value, SQLiteTable)) names.add(getTableName(value));
  }
  return [...names].sort();
}

async function main(): Promise<void> {
  const { db } = await openMemory();

  /* 1. fresh migrate creates every declared table */
  const result = await migrateDevice(db, DEVICE_MIGRATIONS);
  const tables = db.tableNames();
  const declared = declaredTables();
  const missing = declared.filter((name) => !tables.includes(name));
  check(
    "fresh database migrates and creates every declared table",
    missing.length === 0,
    `missing: ${missing.join(", ") || "none"}; applied ${result.applied.length}`
  );
  check("migration count matches the journal", result.applied.length === DEVICE_MIGRATIONS.length);

  /* 2. FTS5 is available (search depends on it) */
  db.run("CREATE VIRTUAL TABLE fts_probe USING fts5(body)");
  db.run("INSERT INTO fts_probe (body) VALUES (?)", ["hello world"]);
  const ftsHit = db.scalar("SELECT count(*) FROM fts_probe WHERE fts_probe MATCH ?", ["hello"]);
  check("FTS5 works in the device engine", Number(ftsHit) === 1, `count=${String(ftsHit)}`);

  /* 3. idempotent second run */
  const second = await migrateDevice(db, DEVICE_MIGRATIONS);
  check("second migrate applies nothing", second.applied.length === 0);

  /* 4. too-new guard */
  db.run(`INSERT INTO "${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES (?, ?)`, [
    "future",
    newestWhen() + 100000,
  ]);
  let tooNew = false;
  try {
    await migrateDevice(db, DEVICE_MIGRATIONS);
  } catch (error) {
    tooNew = error instanceof SchemaTooNewError;
  }
  check("a newer schema is refused, not downgraded", tooNew);
  db.run(`DELETE FROM "${MIGRATIONS_TABLE}" WHERE hash = ?`, ["future"]);

  /* 5. rollback: a broken migration leaves nothing behind */
  const rollbackDb = db;
  const before = latestApplied(rollbackDb)?.createdAt ?? null;
  const broken = [
    ...DEVICE_MIGRATIONS,
    {
      tag: "9999_broken",
      when: 9999999999999,
      hash: "broken",
      statements: [
        "CREATE TABLE rollback_probe (id text primary key)",
        "INSERT INTO does_not_exist (id) VALUES ('x')",
      ],
    },
  ];
  let rolledBack = false;
  try {
    await migrateDevice(rollbackDb, broken);
  } catch {
    rolledBack = true;
  }
  const after = latestApplied(rollbackDb)?.createdAt ?? null;
  check(
    "a failing migration rolls back completely",
    rolledBack && before === after && !rollbackDb.tableNames().includes("rollback_probe"),
    `before=${String(before)} after=${String(after)}`
  );

  /* 6. the pre-migration hook fires before applying */
  const hookResult = await openMemory();
  const hookDb = hookResult.db;
  const hookCalls: { pending: readonly string[]; from: number | null }[] = [];
  await migrateDevice(hookDb, DEVICE_MIGRATIONS, {
    onBeforeMigrate: (info) => {
      hookCalls.push(info);
    },
  });
  const noHook = await migrateDevice(hookDb, DEVICE_MIGRATIONS, {
    onBeforeMigrate: () => {
      hookCalls.push({ pending: [], from: null });
    },
  });
  check(
    "onBeforeMigrate fires once, only when there is work",
    hookCalls.length === 1 && hookCalls[0].pending.length === DEVICE_MIGRATIONS.length && noHook.applied.length === 0
  );

  /* 7. export / deserialize round trip */
  // created_at/updated_at have no SQL default: drizzle's $defaultFn runs in JS,
  // so a raw INSERT has to supply them.
  const stamp = Date.now();
  hookDb.run("INSERT INTO users (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)", [
    "u1",
    "Probe",
    stamp,
    stamp,
  ]);
  const bytes = hookResult.snapshot();
  // Deserialize with the instance that will own the restored database, never
  // with another instance's binding.
  const restoredResult = await openMemory();
  deserializeInto(restoredResult.db, restoredResult.sqlite3, bytes);
  const restored = restoredResult.db;
  const restoredName = restored.scalar("SELECT name FROM users WHERE id = ?", ["u1"]);
  check(
    "export and deserialize round trips data",
    bytes.byteLength > 0 && restoredName === "Probe" && restored.tableNames().length === hookDb.tableNames().length,
    `bytes=${bytes.byteLength}`
  );
  check("a restored database needs no migration", pendingMigrations(restored, DEVICE_MIGRATIONS).length === 0);

  /* 8. server/drizzle compatibility */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-device-"));
  try {
    const BetterSqlite3 = (await import("better-sqlite3")).default;
    const serverDb = new BetterSqlite3(path.join(tmp, "server.db"));
    serverDb.pragma("foreign_keys = ON");
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    migrate(drizzle(serverDb), { migrationsFolder: path.join(process.cwd(), "drizzle") });

    const serverTables = (
      serverDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[]
    ).map((row) => row.name);
    const deviceTables = db.tableNames();
    const mismatched = serverTables.filter((name) => !deviceTables.includes(name));
    check(
      "server and device agree on the table set",
      mismatched.length === 0,
      `server-only: ${mismatched.join(", ") || "none"}`
    );

    const serverDdl = new Map<string, string>(
      (
        serverDb.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all() as {
          name: string;
          sql: string;
        }[]
      ).map((row) => [row.name, row.sql])
    );
    const deviceDdl = new Map<string, string>(
      db
        .all("SELECT name, sql FROM sqlite_master WHERE type='table'")
        .map((row) => [String(row[0]), String(row[1])])
    );
    // Whitespace-normalised for the bookkeeping table only: drizzle emits its
    // DDL from a template literal, so indentation can differ from our copy while
    // the statement stays semantically identical. Every application table comes
    // from the same migration files on both sides, so those are compared byte
    // for byte below.
    const normaliseDdl = (sql: string | undefined) => (sql ?? "").replace(/\s+/g, " ").trim();
    const ddlDiffs = [...serverDdl.keys()].filter(
      (name) => normaliseDdl(serverDdl.get(name)) !== normaliseDdl(deviceDdl.get(name))
    );
    check(
      "table DDL matches between server and device (whitespace-normalised)",
      ddlDiffs.length === 0,
      ddlDiffs.join(", ")
    );
    const byteDiffs = [...serverDdl.keys()]
      .filter((name) => name !== MIGRATIONS_TABLE)
      .filter((name) => serverDdl.get(name) !== deviceDdl.get(name));
    check(
      "every application table is byte-identical between server and device",
      byteDiffs.length === 0,
      byteDiffs.join(", ")
    );

    const serverRows = serverDb
      .prepare(`SELECT hash, created_at FROM "${MIGRATIONS_TABLE}" ORDER BY created_at ASC`)
      .all() as { hash: string; created_at: number }[];
    const deviceRows = db
      .all(`SELECT hash, created_at FROM "${MIGRATIONS_TABLE}" ORDER BY created_at ASC`)
      .map((row) => ({ hash: String(row[0]), created_at: Number(row[1]) }));
    check(
      "migration bookkeeping matches (hash + created_at)",
      serverRows.length === deviceRows.length &&
        serverRows.every((row, index) => row.hash === deviceRows[index].hash && Number(row.created_at) === deviceRows[index].created_at),
      `server=${serverRows.length} device=${deviceRows.length}`
    );
    const serverBytes = fs.readFileSync(path.join(tmp, "server.db"));
    const importedResult = await openMemory();
    const imported = importedResult.db;
    deserializeInto(imported, importedResult.sqlite3, new Uint8Array(serverBytes));
    const afterImport = await migrateDevice(imported, DEVICE_MIGRATIONS);
    check(
      "a server database file imports with zero pending migrations",
      afterImport.applied.length === 0,
      `applied ${afterImport.applied.length}`
    );
    serverDb.close();
  } catch (error) {
    check("server/drizzle compatibility harness ran", false, error instanceof Error ? error.message : String(error));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* 9. drizzle proxy: writes through db.batch, reads back typed values */
  try {
    const db2 = (await openMemory()).db;
    await migrateDevice(db2, DEVICE_MIGRATIONS);
    const executor = {
      async exec(statement: { sql: string; params: readonly unknown[]; method: string }) {
        const params = statement.params as never[];
        if (statement.method === "run") return { rows: [] as never[], changes: db2.run(statement.sql, params).changes };
        if (statement.method === "get") return { rows: (db2.get(statement.sql, params) ?? []) as never[] };
        return { rows: db2.all(statement.sql, params) as never[] };
      },
      async batch(statements: { sql: string; params: readonly unknown[]; method: string }[]) {
        return db2.batch(
          statements.map((statement) => ({
            sql: statement.sql,
            params: statement.params as never[],
            method: statement.method as "run" | "all" | "get" | "values",
          }))
        );
      },
    };
    const orm = createDeviceDrizzle(executor as never);
    const chatId = "c-proxy-test";
    await orm.insert(schema.chats).values({ id: chatId, title: "Proxy probe" });
    await orm.insert(schema.messages).values([
      { id: "m1", chatId, role: "user", content: [{ kind: "text", text: "one" }] },
      { id: "m2", chatId, role: "assistant", content: [{ kind: "text", text: "two" }] },
    ]);
    const readBack = await orm.select().from(schema.messages);
    const chat = await orm.select().from(schema.chats).limit(1);
    check("drizzle proxy writes and reads rows", readBack.length === 2, `rows=${readBack.length}`);
    check("a single row comes back shaped (get path)", chat.length === 1 && chat[0].id === chatId);
    check(
      "typed columns survive the proxy (timestamp -> Date, boolean -> boolean)",
      chat[0].createdAt instanceof Date && typeof chat[0].incognito === "boolean",
      `createdAt=${typeof chat[0].createdAt} incognito=${typeof chat[0].incognito}`
    );
    const ordered = await orm.select().from(schema.messages).orderBy(schema.messages.createdAt);
    check("ordering works through the proxy", ordered.length === 2);
  } catch (error) {
    check("drizzle proxy harness ran", false, error instanceof Error ? error.message : String(error));
  }

  /* 10. batch atomicity */
  try {
    const db3 = (await openMemory()).db;
    await migrateDevice(db3, DEVICE_MIGRATIONS);
    let threw = false;
    try {
      db3.batch([
        {
          sql: "INSERT INTO users (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
          params: ["bad1", "x", stamp, stamp],
          method: "run",
        },
        { sql: "INSERT INTO messages (id, chat_id, role) VALUES (?, ?, ?)", params: ["bad2", "no-such-chat", "user"], method: "run" },
      ]);
    } catch {
      threw = true;
    }
    const leftover = db3.scalar("SELECT count(*) FROM users WHERE id = ?", ["bad1"]);
    check("a batch that violates a foreign key leaves no partial writes", threw && Number(leftover) === 0);
  } catch (error) {
    check("batch atomicity harness ran", false, error instanceof Error ? error.message : String(error));
  }

  /* 11. transaction control is refused outside batch() */
  let refused = false;
  try {
    db.run("BEGIN");
  } catch {
    refused = true;
  }
  check("run() refuses transaction control", refused);

  /* 12. generated migrations are up to date */
  try {
    const generator = pathToFileURL(path.join(process.cwd(), "scripts", "gen-device-migrations.mjs")).href;
    const mod = (await import(generator)) as {
      readDrizzleMigrations: () => unknown;
      renderModule: (migrations: unknown) => string;
    };
    const expected = mod.renderModule(mod.readDrizzleMigrations());
    const actual = fs.readFileSync(
      path.join(process.cwd(), "lib", "device", "engine", "migrations.generated.ts"),
      "utf8"
    );
    check("migrations.generated.ts is not stale", expected === actual);
  } catch (error) {
    check("migration generator import worked", false, error instanceof Error ? error.message : String(error));
  }

  db.close();
  console.log(`\n${passed === total ? "PASS" : "FAIL"} ${passed}/${total}`);
  if (passed !== total) process.exit(1);
}

function newestWhen(): number {
  return DEVICE_MIGRATIONS.reduce((max, migration) => (migration.when > max ? migration.when : max), 0);
}

void main();