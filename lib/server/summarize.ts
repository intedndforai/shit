import { asc, desc, eq } from "drizzle-orm";
import { getAdapter, contentToText } from "@/lib/providers";
import { getActivePath } from "@/lib/server/branches";
import { appendMessage } from "@/lib/server/chats";
import { connectionFromProvider, defaultProviderRow } from "@/lib/server/providers";
import { estimateContentTokens } from "@/lib/tokens";
import { getDb } from "@/lib/db";
import { messages, models, providers, type Provider } from "@/lib/db/schema";

/**
 * Context management: when a conversation approaches the model's window, the
 * oldest messages can be compressed into one summary node. The message tree
 * itself is untouched -- the summary becomes the parent of the surviving tail,
 * and every replaced message stays reachable through it.
 */

const KEEP_LAST = 4;
/** How much history text the summarization call may read. */
const MAX_SUMMARIZE_CHARS = 48_000;

export type SummarizeMode = "auto" | "summarize" | "truncate";

export interface SummarizeResult {
  mode: "summarized" | "truncated" | "noop";
  removed: number;
  kept: number;
  summaryId?: string;
  reason?: string;
}

function summarizationProvider(): Provider | undefined {
  return (
    getDb().select().from(providers).where(eq(providers.isSummarizationModel, true)).limit(1).get() ??
    defaultProviderRow()
  );
}

function summarizationModelId(providerId: string): string | null {
  const row = getDb()
    .select()
    .from(models)
    .where(eq(models.providerId, providerId))
    .orderBy(desc(models.isDefault), asc(models.createdAt))
    .limit(1)
    .get();
  return row ? row.externalId : null;
}

async function generateSummary(title: string | null, head: Array<{ content: unknown }>): Promise<string | null> {
  const provider = summarizationProvider();
  if (!provider) return null;
  const externalId = summarizationModelId(provider.id);
  if (!externalId) return null;

  const transcript = head
    .map((message) => contentToText(message.content as never))
    .filter(Boolean)
    .join("\n\n")
    .slice(-MAX_SUMMARIZE_CHARS);

  const adapter = getAdapter(provider.apiFormat as never);
  const connection = connectionFromProvider(provider);
  let summary = "";
  try {
    for await (const event of adapter.stream({
      ...connection,
      model: externalId,
      system:
        "You condense chat history. Write a dense summary of what the user asked, what was decided, and " +
        "what has been done so far. Preserve names, numbers, file ids, and open questions. 90-180 words.",
      messages: [
        {
          role: "user",
          content: [{ kind: "text", text: `Chat title: ${title ?? "(untitled)"}\n\nHistory:\n${transcript}` }],
        },
      ],
      maxTokens: 1024,
      temperature: 0.2,
    })) {
      if (event.type === "text_delta") summary += event.text;
    }
  } catch {
    return null;
  }
  const clean = summary.trim();
  if (clean.length < 20) return null;
  return `[Summarized earlier conversation] ${clean}`;
}

export async function summarizeChat(chatId: string, mode: SummarizeMode = "auto"): Promise<SummarizeResult> {
  const path = getActivePath(chatId);

  // Keep the oldest user message as the anchor and the last few turns intact.
  const headEnd = Math.max(1, path.length - KEEP_LAST);
  const headToReplace = path.slice(1, headEnd);
  const tail = path.slice(headEnd);

  if (headToReplace.length < 2 || !tail.length) {
    return { mode: "noop", removed: 0, kept: path.length, reason: "The conversation is still short." };
  }

  const wantModel = mode === "summarize" || (mode === "auto" && summarizationProvider() !== undefined);
  let summaryText: string | null = null;
  let usedMode: "summarized" | "truncated" = "truncated";
  let reason: string | undefined;

  if (wantModel) {
    summaryText = await generateSummary(null, headToReplace);
    if (summaryText) {
      usedMode = "summarized";
    } else {
      reason = "The summarization model did not answer; truncated instead.";
    }
  } else {
    reason =
      mode === "truncate"
        ? undefined
        : "No summarization model is configured; truncated instead. Mark a model as the summarization model in Settings to get real summaries.";
  }

  if (!summaryText) {
    summaryText = "[Earlier messages truncated to free context. Ask Conduit if you need any detail from them.]";
  }

  const anchor = path[0];
  const summary = appendMessage({
    chatId,
    role: "system",
    content: [{ kind: "text", text: summaryText }],
    parentId: anchor.id,
  });

  // Re-point the surviving tail onto the summary so the active path becomes
  // [anchor, summary, ...tail]. Old messages remain in the tree under anchor.
  getDb()
    .update(messages)
    .set({ parentId: summary.id })
    .where(eq(messages.id, tail[0].id))
    .run();

  return {
    mode: usedMode,
    removed: headToReplace.length,
    kept: tail.length + 2,
    summaryId: summary.id,
    reason,
  };
}

/** Total estimate for the active path, used by the meter and the summarizer. */
export function contextEstimate(chatId: string): number {
  return estimateContentTokens(getActivePath(chatId).flatMap((message) => message.content ?? []));
}