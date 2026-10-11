import { z } from "zod";
import { getDb } from "@/lib/db";
import { messages as messagesTable, type ContentPart } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAdapter, ProviderError, type InternalMessage, type StreamEvent } from "@/lib/providers";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { appendMessage, createChat, estimateCost, getChat, listMessages, recordUsage, updateChat, updateMessage } from "@/lib/server/chats";
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
  /** Either a plain string or structured parts (images arrive in M4). */
  message: z.union([z.string().min(1), z.array(contentPartSchema)]).optional(),
  modelId: z.string().nullable().optional(),
  providerId: z.string().nullable().optional(),
  systemPrompt: z.string().max(20000).nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(1).max(200000).optional(),
  thinkingBudget: z.number().int().min(0).max(131072).nullable().optional(),
  /** Regenerate the last assistant turn instead of appending a new user turn. */
  regenerate: z.boolean().optional(),
});

function toContentParts(message: string | Array<{ kind: string; text?: string; dataUrl?: string; url?: string; name?: string; mime?: string }>): ContentPart[] {
  if (typeof message === "string") return [{ kind: "text", text: message }];
  return message.flatMap<ContentPart>((part) => {
    if (part.kind === "text") return [{ kind: "text", text: part.text ?? "" }];
    if (part.kind === "image") return [{ kind: "image", dataUrl: part.dataUrl, url: part.url }];
    return [{ kind: "document", name: part.name ?? "document", mime: part.mime ?? "text/plain", text: part.text }];
  });
}

function sseEncode(event: StreamEvent | { type: "message_ids"; userMessageId?: string; assistantMessageId: string } | { type: "chat"; chatId: string; title: string | null }): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function titleFromText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean || "New chat";
}

/** Build the internal conversation history for the adapter. */
function toInternalMessages(rows: ReturnType<typeof listMessages>): InternalMessage[] {
  return rows.map((row) => ({
    role: row.role,
    content: row.content ?? [],
  }));
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;

  // --- Resolve chat, model, provider -------------------------------------
  let chat = body.chatId ? getChat(body.chatId) : undefined;
  if (body.chatId && !chat) return jsonError("Chat not found.", 404);

  const model = body.modelId ? findModel(body.modelId) : getDefaultModel();
  if (!model) {
    return jsonError(
      "No model is configured. Add a provider and a model in Settings before chatting.",
      409
    );
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

  // --- Persist the incoming turn -----------------------------------------
  const history = listMessages(chat.id);

  if (body.regenerate) {
    const lastAssistant = [...history].reverse().find((row) => row.role === "assistant");
    if (lastAssistant) {
      getDb().delete(messagesTable).where(eq(messagesTable.id, lastAssistant.id)).run();
    }
  } else if (body.message) {
    const parts = toContentParts(body.message);
    const stored = appendMessage({ chatId: chat.id, role: "user", content: parts });
    if (!chat.title) {
      const text = parts
        .map((part) => (part.kind === "text" ? part.text : ""))
        .join(" ")
        .trim();
      chat = updateChat(chat.id, { title: titleFromText(text) }) ?? chat;
    }
    history.push(stored);
  }

  const chatId = chat.id;
  const historyRows = listMessages(chatId);
  const systemPrompt =
    body.systemPrompt ??
    chat.systemPrompt ??
    "You are a helpful assistant inside Conduit, a self-hosted chat client.";

  const temperature = body.temperature ?? chat.temperature;
  const topP = body.topP ?? chat.topP;
  const maxTokens = body.maxTokens ?? chat.maxTokens;
  const thinkingBudget = body.thinkingBudget ?? chat.thinkingBudget ?? undefined;

  const adapter = getAdapter(provider.apiFormat as never);
  const connection = connectionFromProvider(provider);

  // Create the assistant row up front so a dropped connection still has a home.
  const assistantRow = appendMessage({
    chatId,
    role: "assistant",
    content: [],
    modelId: model.id,
  });

  const encoder = new TextEncoder();
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const textParts: string[] = [];
      const reasoningParts: string[] = [];
      const toolCalls: ContentPart[] = [];
      let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } = {};
      let errored: string | null = null;

      const send = (event: StreamEvent | { type: "chat"; chatId: string; title: string | null }) => {
        controller.enqueue(encoder.encode(sseEncode(event)));
      };

      send({ type: "chat", chatId, title: chat.title });

      try {
        for await (const event of adapter.stream({
          ...connection,
          model: model.externalId,
          system: systemPrompt,
          messages: toInternalMessages(historyRows),
          temperature,
          topP,
          maxTokens,
          thinkingBudget: thinkingBudget ?? undefined,
          signal: ac.signal,
        })) {
          if (event.type === "text_delta") textParts.push(event.text);
          if (event.type === "reasoning_delta") reasoningParts.push(event.text);
          if (event.type === "usage") usage = { ...usage, ...event.usage };
          if (event.type === "tool_call_end") {
            toolCalls.push({
              kind: "tool_use",
              id: event.id,
              name: "tool",
              input: event.input,
              status: "success",
            });
          }
          if (event.type !== "done") send(event);
        }
      } catch (error) {
        const aborted = ac.signal.aborted;
        errored = aborted
          ? null
          : error instanceof ProviderError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unknown provider error.";

        if (errored) {
          send({ type: "error", message: errored });
        }
      } finally {
        request.signal.removeEventListener("abort", onAbort);

        const content: ContentPart[] = [];
        if (reasoningParts.length) content.push({ kind: "thinking", text: reasoningParts.join("") });
        if (textParts.length) content.push({ kind: "text", text: textParts.join("") });
        content.push(...toolCalls);

        const promptTokens = usage.promptTokens ?? 0;
        const completionTokens = usage.completionTokens ?? 0;
        const cost = estimateCost(
          model.pricePerMillionInput,
          model.pricePerMillionOutput,
          promptTokens,
          completionTokens
        );

        updateMessage(assistantRow.id, {
          content,
          tokenUsage: usage,
          cost,
          error: errored,
        });

        recordUsage({
          providerId: provider.id,
          modelId: model.id,
          chatId,
          promptTokens,
          completionTokens,
          cost,
        });

        if (usage.totalTokens || promptTokens || completionTokens) {
          send({ type: "usage", usage });
        }
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

/** Small helper used by the settings screen to check that a model exists. */
export async function GET() {
  try {
    const model = getDefaultModel();
    return jsonOk({ defaultModel: model ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}