import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { deleteSkill, exportSkill, getSkill, listSkillVersions, restoreSkillVersion, updateSkill, type SkillPatch } from "@/lib/server/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  taskTypes: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  instructions: z.string().trim().max(20000).nullable().optional(),
  requiredTools: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  enabled: z.boolean().optional(),
  trustStatus: z.enum(["trusted", "untrusted", "reviewed"]).optional(),
  provenance: z
    .object({
      url: z.string().url().max(2000).nullable().optional(),
      retrievedAt: z.number().nullable().optional(),
      contentHash: z.string().max(128).nullable().optional(),
    })
    .nullable()
    .optional(),
  restoreVersion: z.number().int().positive().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const skill = getSkill(id);
    if (!skill) return jsonError("Skill not found.", 404);
    return jsonOk({ skill, versions: listSkillVersions(skill.skillKey) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const { restoreVersion, ...rest } = parsed.data;
    let result;
    if (restoreVersion !== undefined) {
      const current = getSkill(id);
      if (!current) return jsonError("Skill not found.", 404);
      result = restoreSkillVersion(current.skillKey, restoreVersion);
    } else {
      const patch: SkillPatch = {};
      if (rest.name !== undefined) patch.name = rest.name;
      if (rest.description !== undefined) patch.description = rest.description ?? "";
      if (rest.taskTypes !== undefined) patch.taskTypes = rest.taskTypes;
      if (rest.instructions !== undefined) patch.instructions = rest.instructions ?? "";
      if (rest.requiredTools !== undefined) patch.requiredTools = rest.requiredTools;
      if (rest.enabled !== undefined) patch.enabled = rest.enabled;
      if (rest.trustStatus !== undefined) patch.trustStatus = rest.trustStatus;
      if (rest.provenance !== undefined) patch.provenance = rest.provenance;
      result = updateSkill(id, patch);
    }
    if ("error" in result) return jsonError(result.error, 400);
    return jsonOk({ skill: result.skill, versionBumped: result.versionBumped ?? false });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return deleteSkill(id) ? jsonOk({ ok: true }) : jsonError("Skill not found.", 404);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Export by skill id (GET with ?skillKey= is used by the client download helper).
  const { id } = await params;
  try {
    const skill = getSkill(id);
    if (!skill) return jsonError("Skill not found.", 404);
    const payload = exportSkill(skill.skillKey);
    return jsonOk({ skill: payload, filename: skill.skillKey + "-v" + skill.version + ".json" });
  } catch (error) {
    return errorResponse(error);
  }
}