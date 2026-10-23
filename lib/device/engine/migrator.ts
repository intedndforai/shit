/**
 * Device schema migrations (W1).
 *
 * The rule replicated here is drizzle's, from
 * node_modules/drizzle-orm/sqlite-core/dialect.js (SQLiteSyncDialect.migrate):
 *
 *   - the bookkeeping table is
 *       CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
 *         id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)
 *   - the last applied row is
 *       SELECT id, hash, created_at FROM "__drizzle_migrations"
 *         ORDER BY created_at DESC LIMIT 1
 *   - a migration is pending when there is no row, or
 *       Number(lastRow.created_at) < migration.when
 *   - each pending migration runs its statements, then inserts
 *       ("hash", "created_at") VALUES (migration.hash, migration.when)
 *   - the whole run happens inside one transaction, rolled back on any error.
 *
 * Replicating it exactly is what makes a server database file and a device
 * database file interchangeable: same table, same hash algorithm, same
 * created_at values, so "Move my data to this device" can import a server file
 * and see zero pending migrations.
 *
 * Two things are added beyond drizzle's version, because a browser has
 * different failure modes from a build script:
 *
 *   - a too-new guard, so an older app build refuses to open a database that a
 *     newer build has already migrated, instead of writing half a schema;
 *   - a pre-migration hook, so the caller can snapshot the file first.
 */

import type { DeviceDatabase } from "./database";
import type { DeviceMigration } from "./migrations.generated";

export const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * The DDL is copied from drizzle verbatim, including `SERIAL`, which SQLite
 * accepts as an ordinary column with NUMERIC affinity. Changing it would make
 * the table definition differ between a server file and a device file.
 */
export const MIGRATIONS_TABLE_DDL =
  'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (\n' +
  "\t\t\tid SERIAL PRIMARY KEY,\n" +
  "\t\t\thash text NOT NULL,\n" +
  "\t\t\tcreated_at numeric\n" +
  "\t\t)";

export class SchemaTooNewError extends Error {
  constructor(
    readonly databaseVersion: number,
    readonly appVersion: number
  ) {
    super(
      `This device database was created by a newer version of the app ` +
        `(schema ${databaseVersion} > ${appVersion}). Update the app before opening it.`
    );
    this.name = "SchemaTooNewError";
  }
}

export class MigrationError extends Error {
  constructor(message: string, readonly migrationTag?: string, readonly cause?: unknown) {
    super(message);
    this.name = "MigrationError";
  }
}

export interface MigrationResult {
  /** Tags applied by this call, in order. Empty when already up to date. */
  applied: string[];
  /** created_at of the last applied migration before this call, or null. */
  from: number | null;
  /** created_at of the last applied migration after this call, or null. */
  to: number | null;
}

export interface MigrationOptions {
  /**
   * Called once, immediately before the first pending migration is applied, and
   * before the transaction opens. Use it to snapshot the database file. Never
   * called when there is nothing to do.
   */
  onBeforeMigrate?: (info: { pending: readonly string[]; from: number | null }) => void | Promise<void>;
}

interface AppliedRow {
  hash: string;
  createdAt: number;
}

/** The most recently applied migration row, or null on a fresh database. */
export function latestApplied(db: DeviceDatabase): AppliedRow | null {
  const row = db.get(
    `SELECT id, hash, created_at FROM "${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`
  );
  if (!row) return null;
  return { hash: String(row[1] ?? ""), createdAt: Number(row[2] ?? 0) };
}

/** The highest migration timestamp this build knows about, or null. */
export function newestKnownVersion(migrations: readonly DeviceMigration[]): number | null {
  if (migrations.length === 0) return null;
  return migrations.reduce((max, migration) => (migration.when > max ? migration.when : max), 0);
}

/** Which of these migrations still need to run, in journal order. */
export function pendingMigrations(
  db: DeviceDatabase,
  migrations: readonly DeviceMigration[]
): DeviceMigration[] {
  const last = latestApplied(db);
  return migrations.filter((migration) => !last || last.createdAt < migration.when);
}

/**
 * Create the bookkeeping table if needed, then apply every pending migration in
 * one transaction. Returns what changed.
 */
export async function migrateDevice(
  db: DeviceDatabase,
  migrations: readonly DeviceMigration[],
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  db.run(MIGRATIONS_TABLE_DDL);

  const last = latestApplied(db);
  const newest = newestKnownVersion(migrations);

  if (last && newest !== null && last.createdAt > newest) {
    throw new SchemaTooNewError(last.createdAt, newest);
  }

  const pending = migrations.filter((migration) => !last || last.createdAt < migration.when);
  if (pending.length === 0) {
    return { applied: [], from: last?.createdAt ?? null, to: last?.createdAt ?? null };
  }

  const ordered = [...pending].sort((a, b) => a.when - b.when);

  if (options.onBeforeMigrate) {
    await options.onBeforeMigrate({
      pending: ordered.map((migration) => migration.tag),
      from: last?.createdAt ?? null,
    });
  }

  const statements: { sql: string; params?: (string | number)[]; method: "run" }[] = [];
  for (const migration of ordered) {
    for (const statement of migration.statements) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      statements.push({ sql: trimmed, method: "run" });
    }
    statements.push({
      sql: `INSERT INTO "${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES(?, ?)`,
      params: [migration.hash, migration.when],
      method: "run",
    });
  }

  try {
    db.batch(statements);
  } catch (error) {
    throw new MigrationError(
      "Applying migrations failed and the database was rolled back.",
      ordered[0]?.tag,
      error
    );
  }

  const violations = db.foreignKeyViolations();
  if (violations.length > 0) {
    throw new MigrationError(
      `Migration left ${violations.length} foreign-key violation(s); the database may be inconsistent.`
    );
  }

  const integrity = db.quickCheck();
  if (integrity !== "ok") {
    throw new MigrationError(`Integrity check after migration failed: ${integrity}`);
  }

  const applied = latestApplied(db);
  return {
    applied: ordered.map((migration) => migration.tag),
    from: last?.createdAt ?? null,
    to: applied?.createdAt ?? ordered[ordered.length - 1].when,
  };
}