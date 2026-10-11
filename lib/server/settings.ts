import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

/** Key/value application settings stored in SQLite (JSON encoded). */

export function getSetting<T>(key: string): T | undefined {
  const row = getDb().select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row ? (row.value as T) : undefined;
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
    .run();
}

export function deleteSetting(key: string): void {
  getDb().delete(appSettings).where(eq(appSettings.key, key)).run();
}