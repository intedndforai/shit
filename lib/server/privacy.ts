/**
 * Server-side privacy state: settings, the metadata-only egress log, provider
 * data-policy profiles, retention purging, and the "delete all my data" action.
 *
 * This module is server-only: it reads/writes SQLite and must never be imported
 * from a client component.
 */

import { createHash } from "node:crypto";
import { desc, eq, lt, sql } from "drizzle-orm";
import { dbHealth, getDb, vacuumDatabase } from "@/lib/db";
import {
  appSettings,
  artifacts,
  attachments,
  chats,
  egressEvents,
  memories,
  messages,
  projectChunks,
  projectFiles,
  projects,
  providers,
  shareLinks,
  usageEvents,
  type EgressKind,
} from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/server/settings";
import {
  DEFAULT_PRIVACY_SETTINGS,
  minimumPolicyLevels,
  privacyModes,
  providerRetentionPolicies,
  providerTrainingPolicies,
  type PrivacyMode,
  type PrivacySettings,
  type ProviderPolicy,
} from "@/lib/privacy/types";

const PRIVACY_KEY = "privacy.settings";

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function oneOf<T extends readonly string[]>(list: T, value: unknown, fallback: T[number]): T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

function stringList(value: unknown, limit = 100): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function getPrivacySettings(): PrivacySettings {
  const stored = getSetting<Partial<PrivacySettings>>(PRIVACY_KEY) ?? {};
  const retention =
    typeof stored.retentionDays === "number" && stored.retentionDays > 0
      ? Math.floor(stored.retentionDays)
      : null;
  return {
    defaultMode: oneOf(privacyModes, stored.defaultMode, DEFAULT_PRIVACY_SETTINGS.defaultMode),
    minimumProviderPolicy: oneOf(
      minimumPolicyLevels,
      stored.minimumProviderPolicy,
      DEFAULT_PRIVACY_SETTINGS.minimumProviderPolicy
    ),
    retentionDays: retention,
    blockRemoteImages:
      typeof stored.blockRemoteImages === "boolean"
        ? stored.blockRemoteImages
        : DEFAULT_PRIVACY_SETTINGS.blockRemoteImages,
    requireSendPreview:
      typeof stored.requireSendPreview === "boolean"
        ? stored.requireSendPreview
        : DEFAULT_PRIVACY_SETTINGS.requireSendPreview,
    customRedactionTerms: stringList(stored.customRedactionTerms),
    customRedactionPatterns: stringList(stored.customRedactionPatterns, 50),
  };
}

export function setPrivacySettings(patch: Partial<PrivacySettings>): PrivacySettings {
  const current = getPrivacySettings();
  const next: PrivacySettings = {
    defaultMode:
      patch.defaultMode === undefined ? current.defaultMode : oneOf(privacyModes, patch.defaultMode, current.defaultMode),
    minimumProviderPolicy:
      patch.minimumProviderPolicy === undefined
        ? current.minimumProviderPolicy
        : oneOf(minimumPolicyLevels, patch.minimumProviderPolicy, current.minimumProviderPolicy),
    retentionDays:
      patch.retentionDays === undefined
        ? current.retentionDays
        : typeof patch.retentionDays === "number" && patch.retentionDays > 0
          ? Math.floor(patch.retentionDays)
          : null,
    blockRemoteImages:
      patch.blockRemoteImages === undefined ? current.blockRemoteImages : Boolean(patch.blockRemoteImages),
    requireSendPreview:
      patch.requireSendPreview === undefined ? current.requireSendPreview : Boolean(patch.requireSendPreview),
    customRedactionTerms:
      patch.customRedactionTerms === undefined
        ? current.customRedactionTerms
        : stringList(patch.customRedactionTerms),
    customRedactionPatterns:
      patch.customRedactionPatterns === undefined
        ? current.customRedactionPatterns
        : stringList(patch.customRedactionPatterns, 50),
  };
  setSetting(PRIVACY_KEY, next);
  return next;
}

export function redactionOptionsFromSettings(settings: PrivacySettings = getPrivacySettings()) {
  return {
    customTerms: settings.customRedactionTerms,
    customPatterns: settings.customRedactionPatterns,
  };
}

/** True when redaction should run for this mode (Private and Strict Local). */
export function redactionActive(mode: PrivacyMode): boolean {
  return mode === "private" || mode === "local";
}

/* ------------------------------------------------------------------ */
/* Provider data-policy profile                                        */
/* ------------------------------------------------------------------ */

export function policyOf(provider: {
  dataPolicyTraining?: string | null;
  dataPolicyRetention?: string | null;
  dataPolicyRegion?: string | null;
  dataPolicyUrl?: string | null;
  dataPolicyDeclaredBy?: string | null;
  dataPolicyDeclaredAt?: Date | null;
}): ProviderPolicy {
  return {
    training: oneOf(providerTrainingPolicies, provider.dataPolicyTraining, "unknown"),
    retention: oneOf(providerRetentionPolicies, provider.dataPolicyRetention, "unknown"),
    region: provider.dataPolicyRegion ?? null,
    url: provider.dataPolicyUrl ?? null,
    declaredBy: provider.dataPolicyDeclaredBy ?? null,
    declaredAt: provider.dataPolicyDeclaredAt ? provider.dataPolicyDeclaredAt.getTime() : null,
  };
}

/** A short human label for a policy, used by badges and the inspector. */
export function policyLabel(policy: ProviderPolicy, local: boolean): string {
  if (local || policy.retention === "local") return "Local endpoint";
  if (policy.retention === "zero-retention-requested") return "Zero-retention requested";
  if (policy.training === "opt-out-requested") return "No-training requested";
  if (policy.training === "not-applicable") return "Training: not applicable";
  return "Provider: policy unknown";
}

/* ------------------------------------------------------------------ */
/* Egress log (metadata only)                                          */
/* ------------------------------------------------------------------ */

export function hashPayload(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return createHash("sha256").update(text ?? "").digest("hex");
}

export interface EgressInput {
  chatId?: string | null;
  providerId?: string | null;
  kind: EgressKind;
  destination: string;
  label?: string | null;
  mode?: PrivacyMode;
  bytesOut?: number;
  redactionCount?: number;
  /** Hashed, never stored. */
  payload?: unknown;
  status?: "ok" | "blocked" | "error";
}

export function recordEgress(input: EgressInput): void {
  try {
    getDb()
      .insert(egressEvents)
      .values({
        chatId: input.chatId ?? null,
        providerId: input.providerId ?? null,
        kind: input.kind,
        destination: input.destination.slice(0, 200),
        label: input.label ? input.label.slice(0, 120) : null,
        mode: input.mode ?? "standard",
        bytesOut: Math.max(0, Math.round(input.bytesOut ?? 0)),
        redactionCount: Math.max(0, Math.round(input.redactionCount ?? 0)),
        payloadHash: input.payload === undefined ? null : hashPayload(input.payload),
        status: input.status ?? "ok",
      })
      .run();
  } catch {
    /* the log must never break a request */
  }
}

export interface EgressRow {
  id: string;
  chatId: string | null;
  providerId: string | null;
  kind: EgressKind;
  destination: string;
  label: string | null;
  mode: string;
  bytesOut: number;
  redactionCount: number;
  payloadHash: string | null;
  status: string;
  createdAt: number;
}

export function listEgress(options: { chatId?: string; limit?: number } = {}): EgressRow[] {
  const limit = Math.min(500, Math.max(1, options.limit ?? 100));
  const db = getDb();
  const where = options.chatId ? eq(egressEvents.chatId, options.chatId) : undefined;
  const rows = (where ? db.select().from(egressEvents).where(where) : db.select().from(egressEvents))
    .orderBy(desc(egressEvents.createdAt))
    .limit(limit)
    .all();
  return rows.map((row) => ({
    id: row.id,
    chatId: row.chatId,
    providerId: row.providerId,
    kind: row.kind as EgressKind,
    destination: row.destination,
    label: row.label,
    mode: row.mode,
    bytesOut: row.bytesOut,
    redactionCount: row.redactionCount,
    payloadHash: row.payloadHash,
    status: row.status,
    createdAt: row.createdAt.getTime(),
  }));
}

export interface DestinationSummary {
  destination: string;
  kinds: string[];
  count: number;
  lastAt: number;
}

/** Group the log by destination for the Privacy Center "where data goes" list. */
export function destinationSummary(limit = 500): DestinationSummary[] {
  const rows = listEgress({ limit });
  const map = new Map<string, DestinationSummary>();
  for (const row of rows) {
    const entry = map.get(row.destination);
    if (entry) {
      entry.count += 1;
      if (!entry.kinds.includes(row.kind)) entry.kinds.push(row.kind);
      if (row.createdAt > entry.lastAt) entry.lastAt = row.createdAt;
      continue;
    }
    map.set(row.destination, {
      destination: row.destination,
      kinds: [row.kind],
      count: 1,
      lastAt: row.createdAt,
    });
  }
  return [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
}

export function clearEgress(chatId?: string): number {
  const db = getDb();
  const result = chatId
    ? db.delete(egressEvents).where(eq(egressEvents.chatId, chatId)).run()
    : db.delete(egressEvents).run();
  return result.changes;
}

/* ------------------------------------------------------------------ */
/* Retention, secure delete, and "delete all my data"                  */
/* ------------------------------------------------------------------ */

/** Apply SQLite hardening pragmas to the live connection. */
export function hardenDatabase(): void {
  const db = getDb();
  db.run(sql`PRAGMA secure_delete = ON`);
}

/** Checkpoint the WAL and rebuild the database file so deleted bytes are gone. */
export function secureVacuum(): void {
  vacuumDatabase();
}

export interface PurgeResult {
  chats: number;
  messages: number;
  attachments: number;
  artifacts: number;
  egressEvents: number;
}

/** Delete chats older than the retention window and everything derived from them. */
export function purgeExpiredChats(retentionDays: number): PurgeResult {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return { chats: 0, messages: 0, attachments: 0, artifacts: 0, egressEvents: 0 };
  }
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const victims = db
    .select({ id: chats.id })
    .from(chats)
    .where(lt(chats.updatedAt, cutoff))
    .all()
    .map((row) => row.id);

  let deletedMessages = 0;
  let deletedAttachments = 0;
  let deletedArtifacts = 0;
  let deletedEgress = 0;
  for (const id of victims) {
    deletedMessages += db.delete(messages).where(eq(messages.chatId, id)).run().changes;
    deletedAttachments += db.delete(attachments).where(eq(attachments.chatId, id)).run().changes;
    deletedArtifacts += db.delete(artifacts).where(eq(artifacts.chatId, id)).run().changes;
    deletedEgress += db.delete(egressEvents).where(eq(egressEvents.chatId, id)).run().changes;
  }
  // The chats FK cascades for messages/attachments/artifacts, so delete the rows
  // explicitly first anyway (secure_delete wipes the freed pages).
  const deletedChats = victims.length
    ? db.delete(chats).where(lt(chats.updatedAt, cutoff)).run().changes
    : 0;

  if (victims.length) {
    db.delete(usageEvents).where(lt(usageEvents.requestAt, cutoff)).run();
    secureVacuum();
  }

  return {
    chats: deletedChats,
    messages: deletedMessages,
    attachments: deletedAttachments,
    artifacts: deletedArtifacts,
    egressEvents: deletedEgress,
  };
}

export interface DeleteAllResult {
  deleted: Record<string, number>;
  vacuumed: boolean;
}

/** Confirmed "delete all my data": wipes user content, then rebuilds the file. */
export function deleteAllData(options: { includeProviders?: boolean } = {}): DeleteAllResult {
  const db = getDb();
  const deleted: Record<string, number> = {};
  const count = (key: string, changes: number) => {
    deleted[key] = (deleted[key] ?? 0) + changes;
  };

  count("egressEvents", db.delete(egressEvents).run().changes);
  count("usageEvents", db.delete(usageEvents).run().changes);
  count("shareLinks", db.delete(shareLinks).run().changes);
  count("memories", db.delete(memories).run().changes);
  count("artifacts", db.delete(artifacts).run().changes);
  count("messages", db.delete(messages).run().changes);
  count("attachments", db.delete(attachments).run().changes);
  count("chats", db.delete(chats).run().changes);
  count("projectChunks", db.delete(projectChunks).run().changes);
  count("projectFiles", db.delete(projectFiles).run().changes);
  count("projects", db.delete(projects).run().changes);
  if (options.includeProviders) count("providers", db.delete(providers).run().changes);

  db.delete(appSettings).where(sql`${appSettings.key} not in ('crypto.version')`).run();
  secureVacuum();
  return { deleted, vacuumed: true };
}

/* ------------------------------------------------------------------ */
/* Storage summary (Privacy Center)                                    */
/* ------------------------------------------------------------------ */

export interface StorageSummary {
  databasePath: string;
  chats: number;
  messages: number;
  attachments: number;
  artifacts: number;
  memories: number;
  projects: number;
  projectFiles: number;
  usageEvents: number;
  egressEvents: number;
  providers: number;
}

/** Row counts for the "what is stored and where" panel. Metadata only. */
export function dataSummary(): StorageSummary {
  const db = getDb();
  const n = (value: unknown): number => Number(value ?? 0);
  return {
    databasePath: dbHealth().path,
    chats: n(db.select({ count: sql<number>`count(*)` }).from(chats).get()?.count),
    messages: n(db.select({ count: sql<number>`count(*)` }).from(messages).get()?.count),
    attachments: n(db.select({ count: sql<number>`count(*)` }).from(attachments).get()?.count),
    artifacts: n(db.select({ count: sql<number>`count(*)` }).from(artifacts).get()?.count),
    memories: n(db.select({ count: sql<number>`count(*)` }).from(memories).get()?.count),
    projects: n(db.select({ count: sql<number>`count(*)` }).from(projects).get()?.count),
    projectFiles: n(db.select({ count: sql<number>`count(*)` }).from(projectFiles).get()?.count),
    usageEvents: n(db.select({ count: sql<number>`count(*)` }).from(usageEvents).get()?.count),
    egressEvents: n(db.select({ count: sql<number>`count(*)` }).from(egressEvents).get()?.count),
    providers: n(db.select({ count: sql<number>`count(*)` }).from(providers).get()?.count),
  };
}
