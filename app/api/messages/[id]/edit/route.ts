import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { appendMessage } from "@/lib/server/chats";
import { nextBranchIndex, setActiveLeaf } from "@/lib/server/branches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ text: z.string().min(1).max(100000) });

/**
 * Edit a user message by creating a sibling branch instead of overwriting
 * history. The client then calls /api/chat to produce a fresh answer.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  try {
    const original = getDb().select().from(messages).where(eq(messages.id, id)).get();
    if (!original) return jsonError("Message not found.", 404);
    if (original.role !== "user") return jsonError("Only user messages can be edited.", 400);

    const siblingRow = appendMessage({
      chatId: original.chatId,
      role: "user",
      content: [{ kind: "text", text: parsed.data.text }],
      parentId: original.parentId,
      branchIndex: nextBranchIndex(original.chatId, original.parentId),
    });

    setActiveLeaf(original.chatId, siblingRow.id);

    return jsonOk({ ok: true, messageId: siblingRow.id, chatId: original.chatId });
  } catch (error) {
    return errorResponse(error);
  }
}