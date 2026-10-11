import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { createPrompt, listPrompts } from "@/lib/server/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  command: z.string().trim().min(1).max(40),
  content: z.string().trim().min(1).max(20000),
});

export async function GET() {
  try {
    return jsonOk({ prompts: listPrompts() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = createPrompt(parsed.data);
    if ("error" in result) return jsonError(result.error, 400);
    return jsonOk({ prompt: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}