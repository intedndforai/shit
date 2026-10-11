import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { createSkill, listSkills, type SkillCreateInput } from "@/lib/server/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  taskTypes: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  instructions: z.string().trim().max(20000).optional(),
  requiredTools: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
});

export async function GET() {
  try {
    return jsonOk({ skills: listSkills() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = createSkill(parsed.data as SkillCreateInput);
    if ("error" in result) return jsonError(result.error, 400);
    return jsonOk({ skill: result.skill }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}