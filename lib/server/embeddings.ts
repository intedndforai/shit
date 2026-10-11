import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { models, providers } from "@/lib/db/schema";
import { decryptText } from "@/lib/crypto";
import { assignedRole } from "@/lib/server/roles";

/**
 * Embeddings through the provider flagged as the embeddings model. Only the
 * OpenAI-compatible `POST {baseUrl}/embeddings` shape is supported; anything
 * else returns null and callers fall back to keyword search.
 */

export interface EmbeddingsConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  headers: Record<string, string>;
}

export function embeddingsConfig(): EmbeddingsConfig | null {
  // A model-level role wins; the provider-level flag is the fallback.
  const assigned = assignedRole("embeddings");
  const provider =
    assigned?.provider ??
    getDb().select().from(providers).where(eq(providers.isEmbeddingsModel, true)).limit(1).get();
  if (!provider) return null;

  const model =
    assigned?.model ??
    getDb()
      .select()
      .from(models)
      .where(eq(models.providerId, provider.id))
      .orderBy(asc(models.createdAt))
      .limit(1)
      .get();

  let apiKey: string | null = null;
  if (provider.apiKeyEncrypted && provider.apiKeyIv) {
    try {
      apiKey = decryptText(provider.apiKeyEncrypted, provider.apiKeyIv);
    } catch {
      apiKey = null;
    }
  }

  return {
    baseUrl: provider.baseUrl.replace(/\/+$/, ""),
    apiKey,
    model: model?.externalId ?? "text-embedding-3-small",
    headers: provider.customHeaders ?? {},
  };
}

/** Returns one vector per input, or null when embeddings are unavailable. */
export async function embedTexts(inputs: string[], signal?: AbortSignal): Promise<number[][] | null> {
  const config = embeddingsConfig();
  if (!config || !inputs.length) return null;

  try {
    const response = await fetch(`${config.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        ...config.headers,
      },
      body: JSON.stringify({ model: config.model, input: inputs }),
      signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const vectors = (payload.data ?? []).map((entry) => entry.embedding ?? []);
    if (vectors.length !== inputs.length || vectors.some((vector) => !vector.length)) return null;
    return vectors;
  } catch {
    return null;
  }
}