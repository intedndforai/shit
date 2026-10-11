import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { assignSkillToProject, listProjectSkills, unassignSkillFromProject } from "@/lib/server/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const assignSchema = z.object({
  skillId: z.string().min(1),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return jsonOk({ skills: listProjectSkills(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, assignSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const assigned = assignSkillToProject(id, parsed.data.skillId);
    if (!assigned) return jsonError("Skill not found.", 404);
    return jsonOk({ skills: listProjectSkills(id), assigned: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const skillId = url.searchParams.get("skillId");
  if (!skillId) return jsonError("skillId query parameter is required.", 400);
  try {
    unassignSkillFromProject(id, skillId);
    return jsonOk({ skills: listProjectSkills(id) });
  } catch (error) {
    return errorResponse(error);
  }
}