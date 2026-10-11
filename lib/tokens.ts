import type { ContentPart } from "@/lib/db/schema";

/**
 * Token estimation shared by the client context meter and the server
 * summarizer. It is deliberately approximate: ~4 characters per token (slightly
 * more for non-ASCII), fixed overheads for images and tool parts. The meter is
 * a safety cue, not a billing statement.
 */

export function estimateTokens(text: string): number {
  const clean = text ?? "";
  if (!clean) return 0;
  const wide = (clean.match(/[^\x00-\x7F]/g) ?? []).length;
  return Math.max(1, Math.ceil((clean.length + wide * 2) / 4));
}

export function estimateContentTokens(parts: ContentPart[] | null | undefined): number {
  if (!parts?.length) return 0;
  let total = 0;
  for (const part of parts) {
    switch (part.kind) {
      case "text":
      case "thinking":
        total += estimateTokens(part.text);
        break;
      case "document":
        total += estimateTokens(part.text ?? `[file: ${part.name}]`);
        break;
      case "tool_use":
        total += estimateTokens(JSON.stringify(part.input ?? {}));
        break;
      case "tool_result":
        total += estimateTokens(part.output);
        break;
      case "image":
        total += 1024 + estimateTokens(part.alt ?? "");
        break;
    }
  }
  return total;
}

export function estimateMessagesTokens(messages: Array<{ content?: ContentPart[] | null }>): number {
  return messages.reduce((total, message) => total + estimateContentTokens(message.content), 0);
}

/** e.g. 1234 -> "1.2k", 128000 -> "128k", 12500 -> "12.5k" */
export function formatTokens(count: number): string {
  if (count < 1000) return String(Math.round(count));
  if (count < 100_000) return `${(count / 1000).toFixed(1)}k`;
  return `${Math.round(count / 1000)}k`;
}

export function estimateCost(
  promptTokens: number,
  completionTokens: number,
  pricePerMillionInput: number,
  pricePerMillionOutput: number
): number {
  return (
    (promptTokens / 1_000_000) * (pricePerMillionInput ?? 0) +
    (completionTokens / 1_000_000) * (pricePerMillionOutput ?? 0)
  );
}