import { z } from "zod";
import { jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { addMemory, listMemories, memoryEnabled, setMemoryEnabled } from "@/lib/server/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({ content: z.string().trim().min(3).max(1000), chatId: z.string().nullable().optional() }),
  z.object({ enabled: z.boolean() }),
]);

export async function GET() {
  try {
    return jsonOk({ enabled: memoryEnabled(), memories: listMemories() });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/memories -- add a fact, or flip the feature on and off. */
export async function POST(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    if ("enabled" in parsed.data) {
      setMemoryEnabled(parsed.data.enabled);
      return jsonOk({ enabled: parsed.data.enabled, memories: listMemories() });
    }
    const memory = addMemory(parsed.data.content, parsed.data.chatId ?? null);
    return jsonOk({ memory, memories: listMemories() }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}