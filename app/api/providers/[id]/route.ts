import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { deleteProvider, listStoredModels, updateProvider } from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  baseUrl: z
    .string()
    .trim()
    .refine((value) => /^https?:\/\//i.test(value), "Base URL must start with http:// or https://")
    .optional(),
  apiKey: z.string().max(400).nullable().optional(),
  apiFormat: z.enum(["openai-completions", "openai-responses", "anthropic", "gemini"]).optional(),
  customHeaders: z.record(z.string(), z.string()).optional(),
  organizationId: z.string().max(200).nullable().optional(),
  projectId: z.string().max(200).nullable().optional(),
  isDefault: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, patchSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const provider = updateProvider(id, parsed.data);
    if (!provider) return jsonError("Provider not found.", 404);
    return jsonOk({ provider });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const removed = deleteProvider(id);
    if (!removed) return jsonError("Provider not found.", 404);
    return jsonOk({ ok: true, models: listStoredModels() });
  } catch (error) {
    return errorResponse(error);
  }
}