import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import {
  CUSTOM_METHODS,
  CustomToolError,
  deleteCustomTool,
  listCustomTools,
  testCustomTool,
  updateCustomTool,
} from "@/lib/tools/custom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(600).optional(),
  method: z.enum(CUSTOM_METHODS).optional(),
  url: z.string().trim().url().max(600).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  requiresApproval: z.boolean().optional(),
  enabled: z.boolean().optional(),
  headers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        value: z.string().max(4000).nullable(),
        secret: z.boolean().optional(),
      })
    )
    .optional(),
});

/** PATCH /api/custom-tools/:id -- edit a tool definition. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const tool = updateCustomTool(id, parsed.data);
    if (!tool) return jsonError("That tool is no longer configured.", 404);
    return jsonOk({ tool, tools: listCustomTools() });
  } catch (error) {
    if (error instanceof CustomToolError) return jsonError(error.message, 400);
    return errorResponse(error);
  }
}

/** POST /api/custom-tools/:id -- run the stored definition with empty arguments. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return jsonOk({ test: await testCustomTool(id) });
  } catch (error) {
    if (error instanceof CustomToolError) return jsonError(error.message, 404);
    return errorResponse(error);
  }
}

/** DELETE /api/custom-tools/:id */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const removed = deleteCustomTool(id);
    if (!removed) return jsonError("That tool is no longer configured.", 404);
    return jsonOk({ tools: listCustomTools() });
  } catch (error) {
    return errorResponse(error);
  }
}