import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { CUSTOM_METHODS, CustomToolError, createCustomTool, listCustomTools } from "@/lib/tools/custom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const headerSchema = z.array(
  z.object({
    name: z.string().trim().min(1).max(120),
    value: z.string().max(4000).nullable(),
    secret: z.boolean().optional(),
  })
);

export const bodySchema = z.object({
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(600).optional(),
  method: z.enum(CUSTOM_METHODS).default("GET"),
  url: z.string().trim().url().max(600),
  parameters: z.record(z.string(), z.unknown()).optional(),
  requiresApproval: z.boolean().optional(),
  enabled: z.boolean().optional(),
  headers: headerSchema.optional(),
});

/** GET /api/custom-tools -- the HTTP tools the user described. */
export async function GET() {
  try {
    return jsonOk({ tools: listCustomTools() });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/custom-tools -- define a tool from a JSON schema. */
export async function POST(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    const tool = createCustomTool(parsed.data);
    return jsonOk({ tool, tools: listCustomTools() }, 201);
  } catch (error) {
    if (error instanceof CustomToolError) return jsonError(error.message, 400);
    return errorResponse(error);
  }
}