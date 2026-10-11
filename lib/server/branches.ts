import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chats, messages, type Message } from "@/lib/db/schema";

/**
 * The conversation is a tree: each message points at its parent and carries a
 * branch index among its siblings. `chats.activeLeafId` selects the path the
 * user currently sees, which is what makes edit-and-branch and answer versions
 * work without ever destroying history.
 */

export interface PathEntry extends Message {
  siblingIndex: number;
  siblingCount: number;
}

export function listAllMessages(chatId: string): Message[] {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(messages.createdAt, messages.branchIndex)
    .all();
}

export function childrenOf(rows: Message[], parentId: string | null): Message[] {
  return rows.filter((row) => row.parentId === parentId).sort((a, b) => a.branchIndex - b.branchIndex);
}

/** Walk from a leaf back to the root, returning the path in chronological order. */
export function pathToRoot(rows: Message[], leafId: string): Message[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const path: Message[] = [];
  let current = byId.get(leafId);
  let guard = 0;

  while (current && guard < 1000) {
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    guard += 1;
  }

  return path.reverse();
}

/** Deepest descendant of a message, preferring the newest branch at each step. */
export function deepestDescendant(rows: Message[], messageId: string): string {
  let currentId = messageId;
  let guard = 0;

  while (guard < 1000) {
    const children = childrenOf(rows, currentId);
    if (!children.length) break;
    currentId = children[children.length - 1].id;
    guard += 1;
  }

  return currentId;
}

/**
 * The visible path: follow `activeLeafId` when it is set, otherwise fall back to
 * the newest message, which keeps chats written by older versions working.
 */
export function getActivePath(chatId: string): PathEntry[] {
  const rows = listAllMessages(chatId);
  if (!rows.length) return [];

  const chat = getDb().select().from(chats).where(eq(chats.id, chatId)).get();
  const activeLeafId = chat?.activeLeafId ?? null;

  let path: Message[];
  if (activeLeafId && rows.some((row) => row.id === activeLeafId)) {
    path = pathToRoot(rows, activeLeafId);
  } else {
    path = pathToRoot(rows, rows[rows.length - 1].id);
  }

  return path.map((message) => {
    const siblings = childrenOf(rows, message.parentId);
    return {
      ...message,
      siblingIndex: siblings.findIndex((sibling) => sibling.id === message.id),
      siblingCount: siblings.length,
    };
  });
}

export function setActiveLeaf(chatId: string, messageId: string | null): void {
  getDb()
    .update(chats)
    .set({ activeLeafId: messageId, updatedAt: new Date() })
    .where(eq(chats.id, chatId))
    .run();
}

/** Next branch index for a new child of `parentId`. */
export function nextBranchIndex(chatId: string, parentId: string | null): number {
  const siblings = childrenOf(listAllMessages(chatId), parentId);
  return siblings.length;
}

export function lastUserMessage(path: PathEntry[]): PathEntry | undefined {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (path[index].role === "user") return path[index];
  }
  return undefined;
}