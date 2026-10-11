import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { connectionFromProvider, getProvider, testConnection } from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    /** Optional overrides so keys can be tested before the provider is saved. */
    baseUrl: z.string().optional(),
    apiKey: z.string().nullable().optional(),
    apiFormat: z.enum(["openai-completions", "openai-responses", "anthropic", "gemini"]).optional(),
    customHeaders: z.record(z.string(), z.string()).optional(),
  })
  .optional();

/** "Test connection" — reports 401/404/timeout problems in plain language. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  const provider = getProvider(id);
  if (!provider) return jsonError("Provider not found.", 404);

  const base = connectionFromProvider(provider);
  const connection = {
    ...base,
    ...(parsed.data?.baseUrl ? { baseUrl: parsed.data.baseUrl } : {}),
    ...(parsed.data?.apiKey ? { apiKey: parsed.data.apiKey } : {}),
    ...(parsed.data?.apiFormat ? { apiFormat: parsed.data.apiFormat } : {}),
    ...(parsed.data?.customHeaders ? { headers: parsed.data.customHeaders } : {}),
  };

  try {
    const result = await testConnection(connection);
    return jsonOk({ ok: true, models: result.models });
  } catch (error) {
    return errorResponse(error);
  }
}