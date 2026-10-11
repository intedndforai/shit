import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { jsonError, jsonOk, errorResponse } from "@/lib/server/api";
import {
  childrenOf,
  deepestDescendant,
  getActivePath,
  listAllMessages,
  setActiveLeaf,
} from "@/lib/server/branches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Direction = "prev" | "next" | "self";

async function readDirection(request: Request): Promise<Direction> {
  // The body is optional, so parse it by hand instead of 400-ing on empty input.
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return "self";
  }
  if (!raw.trim()) return "self";

  try {
    const parsed = JSON.parse(raw) as { direction?: unknown };
    if (parsed.direction === "prev" || parsed.direction === "next" || parsed.direction === "self") {
      return parsed.direction;
    }
  } catch {
    /* fall through to the default */
  }
  return "self";
}

/**
 * Move the visible branch to a message. `direction` steps to a sibling version
 * of the same turn (the answer version switcher), while the default selects the
 * deepest descendant of the message itself.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const row = getDb().select().from(messages).where(eq(messages.id, id)).get();
    if (!row) return jsonError("Message not found.", 404);

    const direction = await readDirection(request);
    let targetId = id;

    if (direction !== "self") {
      const siblings = childrenOf(listAllMessages(row.chatId), row.parentId);
      const index = siblings.findIndex((sibling) => sibling.id === row.id);
      const nextIndex = direction === "prev" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= siblings.length) {
        return jsonError("There is no version in that direction.", 409);
      }
      targetId = siblings[nextIndex].id;
    }

    const leaf = deepestDescendant(listAllMessages(row.chatId), targetId);
    setActiveLeaf(row.chatId, leaf);

    return jsonOk({
      ok: true,
      chatId: row.chatId,
      activeLeafId: leaf,
      messageId: targetId,
      path: getActivePath(row.chatId).map((message) => message.id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}