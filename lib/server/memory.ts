import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { memories } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/server/settings";
import { rankByBm25 } from "@/lib/rag/chunk";

/**
 * Cross-chat memory: short facts the user (or the model, with a <memory> tag)
 * wants remembered. Retrieval is keyword-based, which is predictable and cheap
 * for the handful of facts a person actually keeps.
 */

export interface MemoryDto {
  id: string;
  content: string;
  sourceChatId: string | null;
  createdAt: number;
}

export const MEMORY_TAG_PATTERN = /<memory>([\s\S]*?)<\/memory>/gi;
const MAX_MEMORIES = 500;

export function memoryEnabled(): boolean {
  return getSetting<boolean>("memory.enabled") ?? false;
}

export function setMemoryEnabled(enabled: boolean): void {
  setSetting("memory.enabled", enabled);
}

export function listMemories(): MemoryDto[] {
  return getDb()
    .select()
    .from(memories)
    .orderBy(desc(memories.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      content: row.content,
      sourceChatId: row.sourceChatId,
      createdAt: row.createdAt.getTime(),
    }));
}

export function addMemory(content: string, sourceChatId?: string | null): MemoryDto | null {
  const clean = content.replace(/\s+/g, " ").trim().slice(0, 1000);
  if (clean.length < 3) return null;
  if (listMemories().length >= MAX_MEMORIES) return null;

  const duplicate = getDb().select().from(memories).where(eq(memories.content, clean)).limit(1).get();
  if (duplicate) return null;

  const row = getDb()
    .insert(memories)
    .values({ content: clean, sourceChatId: sourceChatId ?? null })
    .returning()
    .get();

  return { id: row.id, content: row.content, sourceChatId: row.sourceChatId, createdAt: row.createdAt.getTime() };
}

export function updateMemory(id: string, content: string): MemoryDto | null {
  const clean = content.replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!clean) return null;
  const row = getDb().update(memories).set({ content: clean }).where(eq(memories.id, id)).returning().get();
  if (!row) return null;
  return { id: row.id, content: row.content, sourceChatId: row.sourceChatId, createdAt: row.createdAt.getTime() };
}

export function deleteMemory(id: string): boolean {
  return getDb().delete(memories).where(eq(memories.id, id)).run().changes > 0;
}

/** Memories that look relevant to this question, most relevant first. */
export function relevantMemories(query: string, limit = 5): string[] {
  const all = listMemories();
  if (!all.length) return [];
  if (all.length <= limit) return all.map((memory) => memory.content);

  const ranked = rankByBm25(
    query,
    all.map((memory) => memory.content),
    limit
  );
  return ranked.map((entry) => all[entry.index].content);
}

/** Removes memory blocks from a finished answer before it is stored. */
export function stripMemoryTags(text: string): string {
  return text.replace(MEMORY_TAG_PATTERN, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Pulls `<memory>` blocks out of an answer. Returns the cleaned text plus the
 * facts worth storing, so callers can persist them and show the plain answer.
 */
export function extractMemoryProposals(text: string): { text: string; proposals: string[] } {
  const proposals: string[] = [];
  const cleaned = text.replace(MEMORY_TAG_PATTERN, (_match, body: string) => {
    const fact = String(body).replace(/\s+/g, " ").trim();
    if (fact.length >= 3) proposals.push(fact.slice(0, 1000));
    return "";
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), proposals };
}