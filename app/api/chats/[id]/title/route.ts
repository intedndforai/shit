import { jsonError, jsonOk, errorResponse } from "@/lib/server/api";
import { getChat, updateChat } from "@/lib/server/chats";
import { generateTitle } from "@/lib/server/title";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/chats/{id}/title — auto-title a chat with the configured title model. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const chat = getChat(id);
    if (!chat) return jsonError("Chat not found.", 404);

    const title = await generateTitle(id, chat.title);
    if (!title) return jsonOk({ title: chat.title, generated: false });

    updateChat(id, { title }, { titleSource: "model" });
    return jsonOk({ title, generated: true });
  } catch (error) {
    return errorResponse(error);
  }
}