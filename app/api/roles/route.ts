import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { listModelOptions } from "@/lib/server/providers";
import { modelRoles, roleAssignments, setRole, type ModelRole } from "@/lib/server/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  title: z.string().nullable().optional(),
  summarization: z.string().nullable().optional(),
  embeddings: z.string().nullable().optional(),
});

/** GET /api/roles -- which model serves titles, summaries, and embeddings. */
export async function GET() {
  try {
    return jsonOk({ assignments: roleAssignments(), models: listModelOptions() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    let assignments = roleAssignments();
    for (const role of modelRoles) {
      const value = parsed.data[role];
      if (value !== undefined) assignments = setRole(role as ModelRole, value);
    }
    return jsonOk({ assignments, models: listModelOptions() });
  } catch (error) {
    if (error instanceof Error && /no longer exists/.test(error.message)) {
      return jsonError(error.message, 400);
    }
    return errorResponse(error);
  }
}