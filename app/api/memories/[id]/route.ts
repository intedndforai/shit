import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { deleteMemory, listMemories, updateMemory } from "@/lib/server/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({ content: z.string().trim().min(3).max(1000) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const memory = updateMemory(id, parsed.data.content);
    if (!memory) return jsonError("Memory not found.", 404);
    return jsonOk({ memory, memories: listMemories() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return deleteMemory(id) ? jsonOk({ ok: true, memories: listMemories() }) : jsonError("Memory not found.", 404);
  } catch (error) {
    return errorResponse(error);
  }
}