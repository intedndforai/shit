import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { listModelOptions } from "@/lib/server/providers";
import { allPresets, getChatDefaults, setChatDefaults } from "@/lib/server/defaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  presetId: z.string().min(1).max(64).optional(),
  modelId: z.string().min(1).nullable().optional(),
});

/** GET /api/defaults -- model + "AI performance" preset for brand-new chats. */
export async function GET() {
  try {
    return jsonOk({
      defaults: getChatDefaults(),
      presets: allPresets(),
      models: listModelOptions(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    const defaults = setChatDefaults(parsed.data);
    return jsonOk({ defaults, presets: allPresets(), models: listModelOptions() });
  } catch (error) {
    if (error instanceof Error && /no longer exists/.test(error.message)) {
      return jsonError(error.message, 400);
    }
    return errorResponse(error);
  }
}