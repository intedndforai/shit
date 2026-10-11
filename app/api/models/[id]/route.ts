import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { setDefaultModel, updateModelSettings } from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  displayName: z.string().trim().max(120).nullable().optional(),
  contextWindow: z.number().int().min(1024).max(10_000_000).optional(),
  maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
  capabilities: z.record(z.string(), z.boolean()).optional(),
  pricePerMillionInput: z.number().min(0).optional(),
  pricePerMillionOutput: z.number().min(0).optional(),
  isFallback: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, patchSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const { isDefault, ...rest } = parsed.data;
    if (isDefault === true) {
      const row = setDefaultModel(id);
      if (!row) return jsonError("Model not found.", 404);
    }
    const model = updateModelSettings(id, rest);
    if (!model) return jsonError("Model not found.", 404);
    return jsonOk({ model });
  } catch (error) {
    return errorResponse(error);
  }
}