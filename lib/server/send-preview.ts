/**
 * "What will be sent" inspector (Section 3.5).
 *
 * This computes the exact outbound summary without contacting the provider:
 * destination, model, message counts, attachments, memory, tool schemas, and
 * the redactions that would be applied. Only metadata and a payload hash cross
 * the wire — never the rendered prompt.
 */

import type { ContentPart } from "@/lib/db/schema";
import {
  hostOf,
  isLocalEndpoint,
  maskPreview,
  policyGate,
  redactMessages,
  summarizeRedactions,
} from "@/lib/privacy/pipeline";
import type { PrivacyMode, ProviderPolicy, SendPreview } from "@/lib/privacy/types";
import { getAttachment } from "@/lib/files/store";
import { getActivePath } from "@/lib/server/branches";
import { getChat } from "@/lib/server/chats";
import { memoryEnabled, relevantMemories } from "@/lib/server/memory";
import { getPrivacySettings, policyOf, policyLabel, redactionActive, redactionOptionsFromSettings } from "@/lib/server/privacy";
import { findModel, getDefaultModel, getProvider } from "@/lib/server/providers";
import { isLocallyPermittedTool, resolveToolNames, toolEgress, toolSpec } from "@/lib/tools/registry";
import { createHash } from "node:crypto";

export interface PreviewInput {
  chatId?: string | null;
  message?: string | Array<{ kind: string; text?: string; name?: string; mime?: string; alt?: string; attachmentId?: string }>;
  history?: Array<{ role: "system" | "user" | "assistant" | "tool"; content: ContentPart[] }>;
  toolsEnabled?: string[] | null;
  modelId?: string | null;
  providerId?: string | null;
  systemPrompt?: string | null;
}

export type PreviewResult = { ok: true; preview: SendPreview } | { ok: false; status: number; error: string };

function toParts(
  message: PreviewInput["message"]
): ContentPart[] {
  if (!message) return [];
  if (typeof message === "string") return [{ kind: "text", text: message }];
  return message.map((part) => {
    if (part.kind === "text") return { kind: "text" as const, text: part.text ?? "" };
    if (part.kind === "image") return { kind: "image" as const, alt: part.alt, attachmentId: part.attachmentId };
    return {
      kind: "document" as const,
      name: part.name ?? "document",
      mime: part.mime ?? "text/plain",
      attachmentId: part.attachmentId,
    };
  });
}

export function buildSendPreview(input: PreviewInput): PreviewResult {
  const chat = input.chatId ? getChat(input.chatId) : undefined;
  if (input.chatId && !chat) return { ok: false, status: 404, error: "Chat not found." };

  const requestedModelId = input.modelId ?? chat?.modelId ?? null;
  const model = (requestedModelId ? findModel(requestedModelId) : undefined) ?? getDefaultModel();
  if (!model) return { ok: false, status: 409, error: "No model is configured. Add a provider and a model in Settings." };
  const provider = getProvider(input.providerId ?? model.providerId);
  if (!provider) return { ok: false, status: 409, error: "The provider for this model no longer exists." };

  const settings = getPrivacySettings();
  const mode: PrivacyMode = (chat?.privacyMode ?? settings.defaultMode) as PrivacyMode;
  const ephemeral = mode === "incognito" || mode === "local";
  const local = isLocalEndpoint(provider.baseUrl);
  const policy: ProviderPolicy = policyOf(provider);
  const providerLabel = provider.name;

  const gate = policyGate({
    policy,
    providerLabel,
    mode,
    minimum: settings.minimumProviderPolicy,
    isLocalEndpoint: local,
  });

  // Minimize: active branch only (or the transcript the client holds).
  const history: Array<{ role: string; content: ContentPart[] }> = ephemeral
    ? [
        ...(input.history ?? []).map((message) => ({ role: message.role, content: message.content })),
        ...(toParts(input.message).length ? [{ role: "user", content: toParts(input.message) }] : []),
      ]
    : (() => {
        const rows = chat ? getActivePath(chat.id) : [];
        const mapped = rows.map((row) => ({ role: row.role as string, content: (row.content ?? []) as ContentPart[] }));
        const incoming = toParts(input.message);
        return incoming.length ? [...mapped, { role: "user", content: incoming }] : mapped;
      })();

  const parts = history.flatMap((message) => message.content);
  const lastUserText = (() => {
    const lastUser = [...history].reverse().find((message) => message.role === "user");
    if (!lastUser) return "";
    return lastUser.content
      .map((part) =>
        part.kind === "text" ? part.text : part.kind === "document" ? part.text ?? "" : ""
      )
      .join("\n")
      .trim();
  })();

  const memoryItems =
    memoryEnabled() && !ephemeral && mode !== "private" && lastUserText ? relevantMemories(lastUserText) : [];

  const toolCapable = model.capabilities?.toolCalling !== false;
  let enabledToolNames = toolCapable ? resolveToolNames(input.toolsEnabled ?? chat?.toolsEnabled ?? undefined) : [];
  if (mode === "local") enabledToolNames = enabledToolNames.filter((name) => isLocallyPermittedTool(name));

  const applyRedaction = redactionActive(mode);
  const options = redactionOptionsFromSettings(settings);
  const { messages: redactedMessages, entries } = applyRedaction
    ? redactMessages(history, options)
    : { messages: history, entries: [] };

  const redactions = summarizeRedactions(entries);
  const credentials = redactions.items.filter((item) => item.credential);

  const roles: Record<string, number> = {};
  for (const message of redactedMessages) roles[message.role] = (roles[message.role] ?? 0) + 1;

  const attachments = parts
    .filter((part): part is Extract<ContentPart, { kind: "document" | "image" }> => part.kind === "document" || part.kind === "image")
    .map((part) => {
      const stored = part.attachmentId ? getAttachment(part.attachmentId) : undefined;
      if (part.kind === "document") {
        return { name: stored?.name ?? part.name, kind: "document", size: stored?.size ?? part.text?.length ?? 0 };
      }
      return { name: stored?.name ?? part.alt ?? "image", kind: "image", size: stored?.size ?? part.dataUrl?.length ?? 0 };
    });

  const systemPromptChars = (input.systemPrompt ?? chat?.systemPrompt ?? "").length;
  const payloadText = JSON.stringify({
    messages: redactedMessages.map((message) => ({ role: message.role, content: message.content })),
    memory: memoryItems.length,
  });

  const notes: string[] = [];
  if (applyRedaction) {
    notes.push("Reversible redaction is on: masked values are restored in the reply before display and before saving.");
    if (redactions.applied) {
      notes.push(`${redactions.total} value${redactions.total === 1 ? "" : "s"} masked — the answer may be less specific.`);
    }
  } else {
    notes.push("Redaction is off in this mode; the request is sent as typed.");
  }
  notes.push(`Provider policy: ${policyLabel(policy, local)} (user-declared, never verified by Conduit).`);
  if (local) notes.push("This endpoint is a local or private-network address, so content stays on your machine or network.");
  else notes.push("This request leaves the app process for a third-party provider. Conduit cannot verify what the provider does with it.");

  const preview: SendPreview = {
    mode,
    destination: { kind: local ? "local" : "provider", label: providerLabel, host: hostOf(provider.baseUrl) },
    model: model.displayName ?? model.externalId,
    policy,
    gate,
    messages: { count: redactedMessages.length, roles },
    attachments,
    memory: { included: memoryItems.length > 0, items: memoryItems.length },
    tools: enabledToolNames.map((name) => ({
      name,
      label: toolSpec(name)?.label ?? name,
      egress: toolEgress(name),
    })),
    redactions,
    credentials,
    systemPromptChars,
    approxInputTokens: Math.ceil(payloadText.length / 4),
    payloadHash: createHash("sha256").update(payloadText).digest("hex"),
    notes,
  };

  return { ok: true, preview };
}

export { maskPreview };
