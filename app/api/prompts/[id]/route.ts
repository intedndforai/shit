import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { deletePrompt, updatePrompt } from "@/lib/server/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  content: z.string().trim().min(1).max(20000).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const prompt = updatePrompt(id, parsed.data);
    if (!prompt) return jsonError("Prompt not found.", 404);
    return jsonOk({ prompt });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = deletePrompt(id);
    return result.ok ? jsonOk({ ok: true }) : jsonError(result.reason ?? "Could not delete the prompt.", 400);
  } catch (error) {
    return errorResponse(error);
  }
}