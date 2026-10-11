import { z } from "zod";
import { getAdapter, ProviderError, type InternalMessage, type StreamEvent } from "@/lib/providers";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import {
  appendMessage,
  createChat,
  estimateCost,
  getChat,
  recordUsage,
  updateChat,
  updateMessage,
} from "@/lib/server/chats";
import { getActivePath, lastUserMessage, nextBranchIndex, setActiveLeaf } from "@/lib/server/branches";
import { connectionFromProvider, findModel, getDefaultModel, getProvider } from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contentPartSchema = z.object({
  kind: z.enum(["text", "image", "document"]),
  text: z.string().optional(),
  dataUrl: z.string().optional(),
  url: z.string().optional(),
  alt: z.string().optional(),
  name: z.string().optional(),
  mime: z.string().optional(),
});

const bodySchema = z.object({
  chatId: z.string().nullable().optional(),
  /** A new user turn: plain text or structured parts (images, documents). */
  message: z.union([z.string().min(1), z.array(contentPartSchema)]).optional(),
  modelId: z.string().nullable().optional(),
  providerId: z.string().nullable().optional(),
  systemPrompt: z.string().max(20000).nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(1).max(200000).optional(),
  thinkingBudget: z.number().int().min(0).max(131072).nullable().optional(),
  /** Re-answer the last user turn as a new sibling branch. */
  regenerate: z.boolean().optional(),
  /** Answer the current active leaf without adding a user turn. */
  continueFromLeaf: z.boolean().optional(),
});

function toContentParts(
  message:
    | string
    | Array<{
        kind: string;
        text?: string;
        dataUrl?: string;
        url?: string;
        alt?: string;
        name?: string;
        mime?: string;
      }>
) {
  if (typeof message === "string") return [{ kind: "text" as const, text: message }];
  return message.map((part) => {
    if (part.kind === "text") return { kind: "text" as const, text: part.text ?? "" };
    if (part.kind === "image")
      return { kind: "image" as const, dataUrl: part.dataUrl, url: part.url, alt: part.alt };
    return {
      kind: "document" as const,
      name: part.name ?? "document",
      mime: part.mime ?? "text/plain",
      text: part.text,
    };
  });
}

function sseEncode(
  event:
    | StreamEvent
    | { type: "chat"; chatId: string; title: string | null; userMessageId?: string }
    | { type: "message_ids"; assistantMessageId: string }
): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function titleFromText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean || "New chat";
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;

  // --- Resolve chat, model, provider --------------------------------------
  let chat = body.chatId ? getChat(body.chatId) : undefined;
  if (body.chatId && !chat) return jsonError("Chat not found.", 404);

  const model = body.modelId ? findModel(body.modelId) : getDefaultModel();
  if (!model) {
    return jsonError("No model is configured. Add a provider and a model in Settings before chatting.", 409);
  }

  const provider = getProvider(body.providerId ?? model.providerId);
  if (!provider) return jsonError("The provider for this model no longer exists.", 409);

  if (!chat) {
    chat = createChat({
      title: typeof body.message === "string" ? titleFromText(body.message) : null,
      providerId: provider.id,
      modelId: model.id,
      systemPrompt: body.systemPrompt ?? null,
    });
  } else if (body.modelId && body.modelId !== chat.modelId) {
    chat = updateChat(chat.id, { modelId: body.modelId, providerId: provider.id }) ?? chat;
  }

  const chatId = chat.id;

  // --- Place the new turn in the message tree ------------------------------
  let contextRows = getActivePath(chatId);
  let parentId: string | null = null;

  if (body.message) {
    parentId = contextRows.length ? contextRows[contextRows.length - 1].id : null;
    const parts = toContentParts(body.message);
    const userRow = appendMessage({
      chatId,
      role: "user",
      content: parts,
      parentId,
      branchIndex: nextBranchIndex(chatId, parentId),
    });
    setActiveLeaf(chatId, userRow.id);
    parentId = userRow.id;

    if (!chat.title) {
      const text = parts
        .map((part) => (part.kind === "text" ? part.text : ""))
        .join(" ")
        .trim();
      chat = updateChat(chatId, { title: titleFromText(text) }) ?? chat;
    }

    contextRows = getActivePath(chatId);
  } else if (body.regenerate) {
    const lastUser = lastUserMessage(contextRows);
    parentId = lastUser?.id ?? (contextRows.length ? contextRows[contextRows.length - 1].id : null);
    const index = lastUser ? contextRows.findIndex((row) => row.id === lastUser.id) : contextRows.length - 1;
    contextRows = contextRows.slice(0, index + 1);
  } else {
    // continueFromLeaf (used after an edit): answer the current leaf.
    parentId = contextRows.length ? contextRows[contextRows.length - 1].id : null;
  }

  const branchIndex = nextBranchIndex(chatId, parentId);
  const historyForModel: InternalMessage[] = contextRows.map((row) => ({
    role: row.role,
    content: row.content ?? [],
  }));

  const systemPrompt =
    body.systemPrompt ??
    chat.systemPrompt ??
    "You are a helpful assistant inside Conduit, a self-hosted chat client.";

  const adapter = getAdapter(provider.apiFormat as never);
  const connection = connectionFromProvider(provider);

  // Create the assistant row up front so a dropped connection still leaves a saved message.
  const assistantRow = appendMessage({
    chatId,
    role: "assistant",
    content: [],
    modelId: model.id,
    parentId,
    branchIndex,
  });
  setActiveLeaf(chatId, assistantRow.id);

  const encoder = new TextEncoder();
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const textParts: string[] = [];
      const reasoningParts: string[] = [];
      let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } = {};
      let errored: string | null = null;

      const send = (event: Parameters<typeof sseEncode>[0]) =>
        controller.enqueue(encoder.encode(sseEncode(event)));

      send({ type: "chat", chatId, title: chat.title });
      send({ type: "message_ids", assistantMessageId: assistantRow.id });

      try {
        for await (const event of adapter.stream({
          ...connection,
          model: model.externalId,
          system: systemPrompt,
          messages: historyForModel,
          temperature: body.temperature ?? chat.temperature,
          topP: body.topP ?? chat.topP,
          maxTokens: body.maxTokens ?? chat.maxTokens,
          thinkingBudget: body.thinkingBudget ?? chat.thinkingBudget ?? undefined,
          signal: ac.signal,
        })) {
          if (event.type === "text_delta") textParts.push(event.text);
          if (event.type === "reasoning_delta") reasoningParts.push(event.text);
          if (event.type === "usage") usage = { ...usage, ...event.usage };
          if (event.type !== "done") send(event);
        }
      } catch (error) {
        errored = ac.signal.aborted
          ? null
          : error instanceof ProviderError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unknown provider error.";
        if (errored) send({ type: "error", message: errored });
      } finally {
        request.signal.removeEventListener("abort", onAbort);

        const content: Array<{ kind: "thinking"; text: string } | { kind: "text"; text: string }> = [];
        if (reasoningParts.length) content.push({ kind: "thinking", text: reasoningParts.join("") });
        if (textParts.length) content.push({ kind: "text", text: textParts.join("") });

        const promptTokens = usage.promptTokens ?? 0;
        const completionTokens = usage.completionTokens ?? 0;
        const cost = estimateCost(
          model.pricePerMillionInput,
          model.pricePerMillionOutput,
          promptTokens,
          completionTokens
        );

        updateMessage(assistantRow.id, { content, tokenUsage: usage, cost, error: errored });
        recordUsage({
          providerId: provider.id,
          modelId: model.id,
          chatId,
          promptTokens,
          completionTokens,
          cost,
        });

        if (usage.totalTokens || promptTokens || completionTokens) send({ type: "usage", usage });
        send({ type: "done" });
        controller.close();
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

/** Convenience endpoint: the current default model, if any. */
export async function GET() {
  try {
    return jsonOk({ defaultModel: getDefaultModel() ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}