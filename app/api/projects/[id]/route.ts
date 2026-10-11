import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import {
  deleteProject,
  getProject,
  listProjectFiles,
  projectChats,
  projectStats,
  updateProject,
} from "@/lib/server/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(20000).nullable().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const project = getProject(id);
    if (!project) return jsonError("Project not found.", 404);
    return jsonOk({
      project,
      files: listProjectFiles(id),
      chats: projectChats(id),
      stats: projectStats(id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const project = updateProject(id, parsed.data);
    if (!project) return jsonError("Project not found.", 404);
    return jsonOk({ project });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return deleteProject(id) ? jsonOk({ ok: true }) : jsonError("Project not found.", 404);
  } catch (error) {
    return errorResponse(error);
  }
}