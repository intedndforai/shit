import { z } from "zod";
import { jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { getSetting, setSetting } from "@/lib/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Saved conversation-control presets, stored as JSON in app_settings. */
export const presetSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(40),
  temperature: z.number().min(0).max(2),
  topP: z.number().min(0).max(1),
  maxTokens: z.number().int().min(1).max(200000),
  thinkingBudget: z.number().int().min(0).max(131072).nullable().default(null),
  systemPrompt: z.string().max(20000).nullable().default(null),
});

export type Preset = z.infer<typeof presetSchema>;

const bodySchema = z.object({ presets: z.array(presetSchema).max(30) });

export function readPresets(): Preset[] {
  return getSetting<Preset[]>("chat.presets") ?? [];
}

export async function GET() {
  try {
    return jsonOk({ presets: readPresets() });
  } catch (error) {
    return errorResponse(error);
  }
}

/** PUT replaces the whole list; the settings UI is a small local list. */
export async function PUT(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    setSetting("chat.presets", parsed.data.presets);
    return jsonOk({ presets: parsed.data.presets });
  } catch (error) {
    return errorResponse(error);
  }
}