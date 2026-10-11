import { desc, eq, like, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chats, messages } from "@/lib/db/schema";

export interface SearchHit {
  chatId: string;
  messageId: string | null;
  chatTitle: string | null;
  role: string | null;
  snippet: string;
  updatedAt: number;
}

function snippetFor(text: string, query: string): string {
  const lower = text.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index < 0) return text.slice(0, 160);
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + query.length + 100);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** Search chat titles and message bodies. Fast enough for a personal archive. */
export function searchEverything(query: string, limit = 40): SearchHit[] {
  const db = getDb();
  const needle = `%${query}%`;

  const messageRows = db
    .select({
      chatId: messages.chatId,
      messageId: messages.id,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
      chatTitle: chats.title,
      chatUpdatedAt: chats.updatedAt,
    })
    .from(messages)
    .leftJoin(chats, eq(chats.id, messages.chatId))
    .where(like(sql`lower(${messages.content})`, needle.toLowerCase()))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .all();

  const hits: SearchHit[] = messageRows.map((row) => {
    const text = (row.content ?? [])
      .map((part) => (part.kind === "text" ? part.text : part.kind === "thinking" ? "" : ""))
      .join(" ")
      .trim();
    return {
      chatId: row.chatId,
      messageId: row.messageId,
      chatTitle: row.chatTitle,
      role: row.role,
      snippet: snippetFor(text, query),
      updatedAt: (row.chatUpdatedAt ?? row.createdAt).getTime(),
    };
  });

  const titleRows = db
    .select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt })
    .from(chats)
    .where(or(like(sql`lower(${chats.title})`, needle.toLowerCase())))
    .orderBy(desc(chats.updatedAt))
    .limit(limit)
    .all();

  for (const row of titleRows) {
    if (hits.some((hit) => hit.chatId === row.id && hit.messageId === null)) continue;
    hits.unshift({
      chatId: row.id,
      messageId: null,
      chatTitle: row.title,
      role: null,
      snippet: row.title ?? "",
      updatedAt: row.updatedAt.getTime(),
    });
  }

  return hits.slice(0, limit);
}