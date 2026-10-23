import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { buildSendPreview } from "@/lib/server/send-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const partSchema = z.object({
  kind: z.string(),
  text: z.string().optional(),
  name: z.string().optional(),
  mime: z.string().optional(),
  alt: z.string().optional(),
  attachmentId: z.string().optional(),
  dataUrl: z.string().optional(),
});

const bodySchema = z.object({
  chatId: z.string().nullable().optional(),
  message: z.union([z.string(), z.array(partSchema)]).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z.array(partSchema),
      })
    )
    .max(200)
    .optional(),
  toolsEnabled: z.array(z.string()).nullable().optional(),
  modelId: z.string().nullable().optional(),
  providerId: z.string().nullable().optional(),
  systemPrompt: z.string().max(20000).nullable().optional(),
  privacyMode: z.enum(['standard','private','incognito','local']).nullable().optional(),
});

/** POST /api/privacy/preview — the "what will be sent" inspector (metadata only). */
export async function POST(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  try {
    const result = buildSendPreview(parsed.data as Parameters<typeof buildSendPreview>[0]);
    if (!result.ok) return jsonError(result.error, result.status);
    return jsonOk({ preview: result.preview });
  } catch (error) {
    return errorResponse(error);
  }
}
