import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { models, providerFormats, providers, type Provider } from "@/lib/db/schema";
import { decryptText, encryptText, maskSecret } from "@/lib/crypto";
import { getAdapter, type ModelInfo, type ProviderConnection, type ProviderFormat } from "@/lib/providers";

/** Server-side provider storage. API keys are encrypted here and never leave. */

export const providerInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  baseUrl: z
    .string()
    .trim()
    .min(1, "Base URL is required")
    .refine((value) => /^https?:\/\//i.test(value), "Base URL must start with http:// or https://"),
  apiKey: z.string().trim().max(400).optional().nullable(),
  apiFormat: z.enum(providerFormats),
  customHeaders: z.record(z.string(), z.string()).optional(),
  organizationId: z.string().trim().max(200).optional().nullable(),
  projectId: z.string().trim().max(200).optional().nullable(),
});

export type ProviderInput = z.infer<typeof providerInputSchema>;

export interface PublicProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: ProviderFormat;
  customHeaders: Record<string, string>;
  organizationId: string | null;
  projectId: string | null;
  hasApiKey: boolean;
  maskedApiKey: string;
  isDefault: boolean;
  isTitleModel: boolean;
  isSummarizationModel: boolean;
  isEmbeddingsModel: boolean;
  modelCount: number;
  createdAt: number;
}

function toPublic(provider: Provider, modelCount: number): PublicProvider {
  let masked = "";
  if (provider.apiKeyEncrypted && provider.apiKeyIv) {
    try {
      masked = maskSecret(decryptText(provider.apiKeyEncrypted, provider.apiKeyIv));
    } catch {
      masked = "••••";
    }
  }

  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiFormat: provider.apiFormat as ProviderFormat,
    customHeaders: provider.customHeaders ?? {},
    organizationId: provider.organizationId,
    projectId: provider.projectId,
    hasApiKey: Boolean(provider.apiKeyEncrypted),
    maskedApiKey: masked,
    isDefault: provider.isDefault,
    isTitleModel: provider.isTitleModel,
    isSummarizationModel: provider.isSummarizationModel,
    isEmbeddingsModel: provider.isEmbeddingsModel,
    modelCount,
    createdAt: provider.createdAt.getTime(),
  };
}

export function listProviders(): PublicProvider[] {
  const db = getDb();
  const rows = db.select().from(providers).orderBy(desc(providers.createdAt)).all();
  const counts = db
    .select({ providerId: models.providerId, count: sql<number>`count(*)` })
    .from(models)
    .groupBy(models.providerId)
    .all();
  const countMap = new Map(counts.map((row) => [row.providerId, Number(row.count)]));
  return rows.map((row) => toPublic(row, countMap.get(row.id) ?? 0));
}

export function getProvider(id: string): Provider | undefined {
  return getDb().select().from(providers).where(eq(providers.id, id)).get();
}

export function createProvider(input: ProviderInput): PublicProvider {
  const db = getDb();
  const encrypted = input.apiKey ? encryptText(input.apiKey) : null;

  const isFirst = db.select({ count: sql<number>`count(*)` }).from(providers).get()?.count === 0;

  const row = db
    .insert(providers)
    .values({
      name: input.name,
      baseUrl: input.baseUrl,
      apiFormat: input.apiFormat,
      apiKeyEncrypted: encrypted?.ciphertext ?? null,
      apiKeyIv: encrypted?.iv ?? null,
      customHeaders: input.customHeaders ?? {},
      organizationId: input.organizationId ?? null,
      projectId: input.projectId ?? null,
      isDefault: Boolean(isFirst),
    })
    .returning()
    .get();

  return toPublic(row, 0);
}

export function updateProvider(id: string, input: Partial<ProviderInput> & { isDefault?: boolean }): PublicProvider | undefined {
  const db = getDb();
  const existing = getProvider(id);
  if (!existing) return undefined;

  const patch: Partial<Provider> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
  if (input.apiFormat !== undefined) patch.apiFormat = input.apiFormat;
  if (input.customHeaders !== undefined) patch.customHeaders = input.customHeaders;
  if (input.organizationId !== undefined) patch.organizationId = input.organizationId;
  if (input.projectId !== undefined) patch.projectId = input.projectId;

  // An empty string clears the stored key; undefined leaves it untouched.
  if (input.apiKey !== undefined) {
    if (input.apiKey === null || input.apiKey === "") {
      patch.apiKeyEncrypted = null;
      patch.apiKeyIv = null;
    } else {
      const encrypted = encryptText(input.apiKey);
      patch.apiKeyEncrypted = encrypted.ciphertext;
      patch.apiKeyIv = encrypted.iv;
    }
  }

  if (input.isDefault) {
    db.update(providers).set({ isDefault: false }).run();
    patch.isDefault = true;
  }

  const row = db.update(providers).set(patch).where(eq(providers.id, id)).returning().get();
  const count = db
    .select({ count: sql<number>`count(*)` })
    .from(models)
    .where(eq(models.providerId, id))
    .get()?.count;

  return toPublic(row, Number(count ?? 0));
}

export function deleteProvider(id: string): boolean {
  const result = getDb().delete(providers).where(eq(providers.id, id)).run();
  return result.changes > 0;
}

/** Build a connection object (with the decrypted key) for adapter calls. */
export function connectionFromProvider(provider: Provider): ProviderConnection {
  let apiKey: string | null = null;
  if (provider.apiKeyEncrypted && provider.apiKeyIv) {
    apiKey = decryptText(provider.apiKeyEncrypted, provider.apiKeyIv);
  }

  return {
    baseUrl: provider.baseUrl,
    apiKey,
    apiFormat: provider.apiFormat as ProviderFormat,
    headers: provider.customHeaders ?? {},
    organizationId: provider.organizationId,
    projectId: provider.projectId,
  };
}

/** Verify a provider answers, using the cheapest endpoint available. */
export async function testConnection(connection: ProviderConnection): Promise<{ ok: true; models: number }> {
  const adapter = getAdapter(connection.apiFormat);
  const list = await adapter.listModels(connection);
  return { ok: true, models: list.length };
}

/** Refresh the model list for a provider and persist it. */
export function syncModels(providerId: string, discovered: ModelInfo[]) {
  const db = getDb();
  const existing = db.select().from(models).where(eq(models.providerId, providerId)).all();
  const byExternalId = new Map(existing.map((row) => [row.externalId, row]));

  for (const model of discovered) {
    const match = byExternalId.get(model.id);
    if (match) {
      db.update(models)
        .set({
          displayName: model.displayName ?? match.displayName,
          contextWindow: model.contextWindow ?? match.contextWindow,
        })
        .where(eq(models.id, match.id))
        .run();
      continue;
    }

    db.insert(models)
      .values({
        providerId,
        externalId: model.id,
        displayName: model.displayName ?? model.id,
        contextWindow: model.contextWindow ?? 128000,
        maxOutputTokens: model.maxOutputTokens ?? 8192,
      })
      .run();
  }

  return db
    .select()
    .from(models)
    .where(eq(models.providerId, providerId))
    .orderBy(models.externalId)
    .all();
}

export function listStoredModels(providerId?: string) {
  const db = getDb();
  const query = db.select().from(models);
  const rows = providerId
    ? query.where(eq(models.providerId, providerId)).orderBy(models.externalId).all()
    : query.orderBy(models.externalId).all();
  return rows;
}

export function setDefaultModel(modelId: string) {
  const db = getDb();
  const model = db.select().from(models).where(eq(models.id, modelId)).get();
  if (!model) return undefined;
  db.update(models).set({ isDefault: false }).run();
  db.update(models).set({ isDefault: true }).where(eq(models.id, modelId)).run();
  return model;
}

/** The configured fallback model (models with isFallback), preferring the default provider. */
export function fallbackModelFor(current: { id: string; providerId: string }) {
  const rows = getDb()
    .select()
    .from(models)
    .where(eq(models.isFallback, true))
    .orderBy(desc(models.isDefault), asc(models.createdAt))
    .all();
  return (
    rows.find((row) => row.id !== current.id && row.providerId === current.providerId) ??
    rows.find((row) => row.id !== current.id) ??
    undefined
  );
}

export function getDefaultModel() {
  return getDb()
    .select()
    .from(models)
    .where(eq(models.isDefault, true))
    .limit(1)
    .get();
}

export function findModel(modelId: string) {
  return getDb().select().from(models).where(eq(models.id, modelId)).get();
}

export function updateModelSettings(
  modelId: string,
  patch: {
    displayName?: string | null;
    contextWindow?: number;
    maxOutputTokens?: number;
    capabilities?: Record<string, boolean>;
    pricePerMillionInput?: number;
    pricePerMillionOutput?: number;
    isFallback?: boolean;
  }
) {
  const db = getDb();
  const row = db
    .update(models)
    .set(patch)
    .where(eq(models.id, modelId))
    .returning()
    .get();
  return row;
}

export function hasAnyProvider(): boolean {
  const row = getDb().select({ id: providers.id }).from(providers).limit(1).get();
  return Boolean(row);
}

export function defaultProviderRow() {
  const db = getDb();
  return (
    db.select().from(providers).where(eq(providers.isDefault, true)).limit(1).get() ??
    db.select().from(providers).orderBy(providers.createdAt).limit(1).get()
  );
}

export function countProviders(): number {
  const row = getDb().select({ count: sql<number>`count(*)` }).from(providers).get();
  return Number(row?.count ?? 0);
}

export { and, eq };