import { z } from "zod";
import { jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { summarizeChat, type SummarizeMode } from "@/lib/server/summarize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mode: z.enum(["auto", "summarize", "truncate"]).default("auto"),
});

/**
 * POST /api/chats/:id/summarize -- compresses the oldest turns into one summary
 * node (or just truncates them when no summarization model is configured).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await summarizeChat(id, parsed.data.mode as SummarizeMode);
    return jsonOk(result);
  } catch (error) {
    return errorResponse(error);
  }
}