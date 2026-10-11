import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { chats, messages, usageEvents, type Chat, type ChatRole, type ContentPart } from "@/lib/db/schema";

/** Server-side chat + message persistence and usage accounting. */

export const chatPatchSchema = z.object({
  title: z.string().trim().max(120).nullable().optional(),
  systemPrompt: z.string().max(20000).nullable().optional(),
  providerId: z.string().nullable().optional(),
  modelId: z.string().nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(1).max(200000).optional(),
  thinkingBudget: z.number().int().min(0).max(131072).nullable().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export type ChatPatch = z.infer<typeof chatPatchSchema>;

export interface ChatSummary {
  id: string;
  title: string | null;
  modelId: string | null;
  providerId: string | null;
  pinned: boolean;
  archived: boolean;
  updatedAt: number;
  createdAt: number;
  messageCount: number;
}

export function listChats(): ChatSummary[] {
  const db = getDb();
  const rows = db.select().from(chats).orderBy(desc(chats.pinned), desc(chats.updatedAt)).all();
  const counts = db
    .select({ chatId: messages.chatId })
    .from(messages)
    .all()
    .reduce<Map<string, number>>((acc, row) => {
      acc.set(row.chatId, (acc.get(row.chatId) ?? 0) + 1);
      return acc;
    }, new Map());

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    modelId: row.modelId,
    providerId: row.providerId,
    pinned: row.pinned,
    archived: row.archived,
    updatedAt: row.updatedAt.getTime(),
    createdAt: row.createdAt.getTime(),
    messageCount: counts.get(row.id) ?? 0,
  }));
}

export function createChat(input: {
  title?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  systemPrompt?: string | null;
}): Chat {
  return getDb()
    .insert(chats)
    .values({
      title: input.title ?? null,
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      systemPrompt: input.systemPrompt ?? null,
    })
    .returning()
    .get();
}

export function getChat(id: string): Chat | undefined {
  return getDb().select().from(chats).where(eq(chats.id, id)).get();
}

export function listMessages(chatId: string) {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.createdAt), asc(messages.branchIndex))
    .all();
}

export function updateChat(id: string, patch: ChatPatch): Chat | undefined {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) values[key] = value;
  }
  return getDb().update(chats).set(values).where(eq(chats.id, id)).returning().get();
}

export function deleteChat(id: string): boolean {
  return getDb().delete(chats).where(eq(chats.id, id)).run().changes > 0;
}

export function appendMessage(input: {
  chatId: string;
  role: ChatRole;
  content: ContentPart[];
  modelId?: string | null;
  parentId?: string | null;
  branchIndex?: number;
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  cost?: number;
  error?: string | null;
}) {
  const db = getDb();
  const row = db
    .insert(messages)
    .values({
      chatId: input.chatId,
      role: input.role,
      content: input.content,
      modelId: input.modelId ?? null,
      parentId: input.parentId ?? null,
      branchIndex: input.branchIndex ?? 0,
      tokenUsage: input.tokenUsage ?? {},
      cost: input.cost ?? 0,
      error: input.error ?? null,
    })
    .returning()
    .get();

  db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, input.chatId)).run();
  return row;
}

export function updateMessage(
  messageId: string,
  patch: {
    content?: ContentPart[];
    tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    cost?: number;
    error?: string | null;
  }
) {
  return getDb().update(messages).set(patch).where(eq(messages.id, messageId)).returning().get();
}

export function deleteMessage(messageId: string): boolean {
  return getDb().delete(messages).where(eq(messages.id, messageId)).run().changes > 0;
}

export function recordUsage(input: {
  providerId?: string | null;
  modelId?: string | null;
  chatId?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
}) {
  const promptTokens = input.promptTokens ?? 0;
  const completionTokens = input.completionTokens ?? 0;
  getDb()
    .insert(usageEvents)
    .values({
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      chatId: input.chatId ?? null,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cost: input.cost ?? 0,
    })
    .run();
}

/** Estimate the cost of a request from the model's per-million pricing. */
export function estimateCost(
  pricePerMillionInput: number,
  pricePerMillionOutput: number,
  promptTokens: number,
  completionTokens: number
): number {
  return (promptTokens / 1_000_000) * pricePerMillionInput + (completionTokens / 1_000_000) * pricePerMillionOutput;
}