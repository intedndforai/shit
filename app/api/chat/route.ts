import { z } from "zod";
import type { ContentPart } from "@/lib/db/schema";
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
import { recordArtifacts } from "@/lib/server/artifacts";
import { resolveToolNames, runTool, toolDefinitions, type ToolCitation } from "@/lib/tools/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many assistant→tool→assistant rounds one answer may take. */
const MAX_TOOL_ROUNDS = 6;

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
  /** Per-chat tool selection; null means "use the registry defaults". */
  toolsEnabled: z.array(z.string()).nullable().optional(),
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

type OutgoingEvent =
  | StreamEvent
  | { type: "chat"; chatId: string; title: string | null }
  | { type: "message_ids"; assistantMessageId: string }
  | { type: "tool_status"; id: string; name: string; status: "running" | "success" | "error" }
  | {
      type: "tool_result";
      id: string;
      name: string;
      output: string;
      isError: boolean;
      citations?: ToolCitation[];
    };

function sseEncode(event: OutgoingEvent): string {
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

  // A tool selection sent with the turn is remembered on the chat.
  if (body.toolsEnabled !== undefined) {
    chat = updateChat(chatId, { toolsEnabled: body.toolsEnabled }) ?? chat;
  }

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
    "You are a helpful assistant inside Conduit, a self-hosted chat client. Use the tools you are given when they help, and cite any URLs you rely on.";

  const adapter = getAdapter(provider.apiFormat as never);
  const connection = connectionFromProvider(provider);

  // Tools are offered only when the model is not explicitly marked as
  // tool-incapable, and only for tools the user has configured.
  const toolCapable = model.capabilities?.toolCalling !== false;
  const enabledToolNames = toolCapable ? resolveToolNames(chat.toolsEnabled ?? undefined) : [];
  const tools = enabledToolNames.length ? toolDefinitions(enabledToolNames) : undefined;

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
      /** Persisted content for this answer, in the order it happened. */
      const timeline: ContentPart[] = [];
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let errored: string | null = null;

      const send = (event: OutgoingEvent) => controller.enqueue(encoder.encode(sseEncode(event)));

      const pushText = (delta: string) => {
        const last = timeline[timeline.length - 1];
        if (last?.kind === "text") last.text += delta;
        else timeline.push({ kind: "text", text: delta });
      };

      send({ type: "chat", chatId, title: chat.title });
      send({ type: "message_ids", assistantMessageId: assistantRow.id });

      try {
        const history = [...historyForModel];
        let round = 0;

        while (round < MAX_TOOL_ROUNDS) {
          round += 1;
          const pending = new Map<string, { name: string; input: unknown; args: string }>();
          const roundText: string[] = [];

          for await (const event of adapter.stream({
            ...connection,
            model: model.externalId,
            system: systemPrompt,
            messages: history,
            temperature: body.temperature ?? chat.temperature,
            topP: body.topP ?? chat.topP,
            maxTokens: body.maxTokens ?? chat.maxTokens,
            thinkingBudget: body.thinkingBudget ?? chat.thinkingBudget ?? undefined,
            tools,
            signal: ac.signal,
          })) {
            if (event.type === "text_delta") {
              roundText.push(event.text);
              textParts.push(event.text);
              pushText(event.text);
              send(event);
              continue;
            }
            if (event.type === "reasoning_delta") {
              reasoningParts.push(event.text);
              send(event);
              continue;
            }
            if (event.type === "usage") {
              usage = {
                promptTokens: usage.promptTokens + (event.usage.promptTokens ?? 0),
                completionTokens: usage.completionTokens + (event.usage.completionTokens ?? 0),
                totalTokens: usage.totalTokens + (event.usage.totalTokens ?? 0),
              };
              continue;
            }
            if (event.type === "tool_call_start") {
              pending.set(event.id, { name: event.name, input: {}, args: "" });
              send(event);
              continue;
            }
            if (event.type === "tool_call_delta") {
              const call = pending.get(event.id);
              if (call) call.args += event.argumentsDelta;
              continue;
            }
            if (event.type === "tool_call_end") {
              const call = pending.get(event.id);
              if (call) {
                call.input = event.input;
                call.args = "";
              }
              send(event);
              continue;
            }
            if (event.type === "error") {
              throw new ProviderError(event.message, { status: event.status });
            }
            if (event.type === "done") continue;
          }

          if (!pending.size) break;

          // The assistant asked for tools: record the request, run them, and
          // feed the results back for another round.
          const assistantContent: ContentPart[] = [];
          if (roundText.length) assistantContent.push({ kind: "text", text: roundText.join("") });
          for (const [id, call] of pending) {
            const part: ContentPart = {
              kind: "tool_use",
              id,
              name: call.name,
              input: call.input,
              status: "running",
            };
            assistantContent.push(part);
            timeline.push(part);
          }
          history.push({ role: "assistant", content: assistantContent });

          const resultParts: ContentPart[] = [];
          for (const [id, call] of pending) {
            send({ type: "tool_status", id, name: call.name, status: "running" });
            const result = await runTool(call.name, call.input);

            const index = timeline.findIndex((part) => part.kind === "tool_use" && part.id === id);
            if (index >= 0 && timeline[index].kind === "tool_use") {
              const part = timeline[index];
              if (part.kind === "tool_use") {
                timeline[index] = {
                  ...part,
                  status: result.isError ? "error" : "success",
                  ...(result.isError ? { error: result.output.slice(0, 400) } : {}),
                };
              }
            }

            const resultPart: ContentPart = {
              kind: "tool_result",
              id,
              output: result.output,
              isError: result.isError,
            };
            timeline.push(resultPart);
            resultParts.push(resultPart);

            send({
              type: "tool_result",
              id,
              name: call.name,
              output: result.output,
              isError: result.isError,
              citations: result.citations,
            });
            send({ type: "tool_status", id, name: call.name, status: result.isError ? "error" : "success" });
          }

          history.push({ role: "tool", content: resultParts });
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

        const content: ContentPart[] = [];
        if (reasoningParts.length) content.push({ kind: "thinking", text: reasoningParts.join("") });
        content.push(...timeline);

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

        // Artifact blocks become versioned rows so the panel can diff them.
        if (textParts.length) {
          try {
            recordArtifacts({ chatId, messageId: assistantRow.id, text: textParts.join("") });
          } catch {
            /* artifact capture is best-effort */
          }
        }

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
    return jsonOk({ defaultModel: getDefaultModel() ?? null, tools: resolveToolNames() });
  } catch (error) {
    return errorResponse(error);
  }
}
