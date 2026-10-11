import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { importSkill } from "@/lib/server/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  payload: z.unknown(),
});

export async function POST(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = importSkill(parsed.data.payload);
    if ("error" in result) return jsonError(result.error, result.reason === "oversized" ? 413 : 400);
    return jsonOk({ skill: result.skill, trustStatus: result.skill.trustStatus }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}