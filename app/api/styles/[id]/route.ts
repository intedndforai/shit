import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { deleteStyle, updateStyle } from "@/lib/server/styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  instructions: z.string().trim().max(4000).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const style = updateStyle(id, parsed.data);
    if (!style) return jsonError("Style not found.", 404);
    return jsonOk({ style });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = deleteStyle(id);
    return result.ok ? jsonOk({ ok: true }) : jsonError(result.reason ?? "Could not delete the style.", 400);
  } catch (error) {
    return errorResponse(error);
  }
}