import { z } from "zod";
import type { ContentPart } from "@/lib/db/schema";
import { getAdapter, ProviderError, type InternalMessage, type StreamEvent } from "@/lib/providers";
import { isLocalEndpoint, policyGate, redactMessages, summarizeRedactions } from "@/lib/privacy/pipeline";
import {
  credentialMatches,
  PlaceholderRestorer,
  redactText,
  restoreText,
  type RedactionEntry,
} from "@/lib/privacy/redact";
import type { PrivacyMode, RedactionSummary } from "@/lib/privacy/types";
import {
  getPrivacySettings,
  policyLabel,
  policyOf,
  recordEgress,
  redactionActive,
  redactionOptionsFromSettings,
} from "@/lib/server/privacy";
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
import {
  connectionFromProvider,
  fallbackModelFor,
  findModel,
  getDefaultModel,
  getProvider,
} from "@/lib/server/providers";
import { recordArtifacts } from "@/lib/server/artifacts";
import { linkAttachments } from "@/lib/files/store";
import {
  isLocallyPermittedTool,
  resolveToolNames,
  toolEgressKind,
  runTool,
  toolDefinitions,
  toolEgress,
  toolSpec,
  type ToolCitation,
} from "@/lib/tools/registry";
import { readToolsConfig, searchDestination } from "@/lib/tools/web-search";
import { waitForClientTool } from "@/lib/server/pending-tools";
import { styleInstructions } from "@/lib/server/styles";
import { getProject, retrieveProjectContext, type RetrievedPassage } from "@/lib/server/projects";
import { activeSkillInstructions } from "@/lib/server/skills";
import {
  addMemory,
  extractMemoryProposals,
  memoryEnabled,
  relevantMemories,
  stripMemoryTags,
} from "@/lib/server/memory";
import { profileInstructions } from "@/lib/server/profile";
import {
  buildResearchContext,
  gatherResearchSources,
  planResearchQueries,
  type ResearchStep,
} from "@/lib/server/research";

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
  /** Stored attachment this part came from, when it was uploaded first. */
  attachmentId: z.string().optional(),
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
  /** Deep Research: plan, search, fetch, then answer with citations. */
  research: z.boolean().optional(),
  /** One-time overrides for the privacy gate (Sections 3.4, 3.6, 3.14). */
  allowPolicyOnce: z.boolean().optional(),
  allowCredentials: z.boolean().optional(),
  /**
   * Transcript sent by the client. Only used for incognito chats, which never
   * touch the database, so their context lives in the tab that owns them.
   */
  history: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z.array(contentPartSchema),
      })
    )
    .max(200)
    .optional(),
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
        attachmentId?: string;
      }>
) {
  if (typeof message === "string") return [{ kind: "text" as const, text: message }];
  return message.map((part) => {
    if (part.kind === "text") return { kind: "text" as const, text: part.text ?? "" };
    if (part.kind === "image")
      return {
        kind: "image" as const,
        dataUrl: part.dataUrl,
        url: part.url,
        alt: part.alt,
        attachmentId: part.attachmentId,
      };
    return {
      kind: "document" as const,
      name: part.name ?? "document",
      mime: part.mime ?? "text/plain",
      text: part.text,
      attachmentId: part.attachmentId,
    };
  });
}

/**
 * Memory tags are stripped before an answer is stored: the fact lives in
 * Settings, and the transcript keeps the plain answer.
 */
function stripMemoryTagsFromParts(parts: ContentPart[]): ContentPart[] {
  return parts.map((part) => (part.kind === "text" ? { ...part, text: stripMemoryTags(part.text) } : part));
}

type OutgoingEvent =
  | StreamEvent
  | { type: "chat"; chatId: string; title: string | null }
  | { type: "message_ids"; assistantMessageId: string }
  | { type: "model_switch"; modelLabel: string; reason?: string }
  | {
      type: "sources";
      mode: "embeddings" | "keywords" | "none";
      sources: Array<{ title: string; snippet: string }>;
    }
  | { type: "memory"; fact: string }
  | { type: "redactions"; summary: RedactionSummary }
  | { type: "research_step"; id: string; label: string; status: string; detail?: string }
  | {
      type: "research_sources";
      sources: Array<{ title: string; url: string; snippet: string }>;
    }
  | { type: "tool_status"; id: string; name: string; status: "running" | "success" | "error" }
  | {
      type: "tool_approval";
      id: string;
      name: string;
      label: string;
      input: unknown;
      requiresApproval: boolean;
      /** Server tools ask for a decision; client tools run in the browser. */
      execution: "server" | "client";
      /** Where the approved call would send data (Section 3.10). */
      egress: { kind: "none" | "local" | "thirdParty"; destination?: string; note?: string };
    }
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

  // A chat stays on its own model once it has one; the body may override it.
  const requestedModelId = body.modelId ?? chat?.modelId ?? null;
  const initialModel = (requestedModelId ? findModel(requestedModelId) : undefined) ?? getDefaultModel();
  if (!initialModel) {
    return jsonError("No model is configured. Add a provider and a model in Settings before chatting.", 409);
  }
  let model: typeof initialModel = initialModel;

  const initialProvider = getProvider(body.providerId ?? initialModel.providerId);
  if (!initialProvider) return jsonError("The provider for this model no longer exists.", 409);
  let provider: typeof initialProvider = initialProvider;

  // Image routing: an image may only be sent to a model the user marked as
  // vision-capable. This is the enforcement point; the composer warns earlier.
  const incomingParts = typeof body.message === "string" ? [] : body.message ?? [];
  const historyParts = (body.history ?? []).flatMap((message) => message.content);
  if (
    [...incomingParts, ...historyParts].some((part) => part.kind === "image") &&
    model.capabilities?.vision !== true
  ) {
    return jsonError(
      `"${model.displayName ?? model.externalId}" is not configured for vision, so the image was not sent. Pick a vision-capable model for this turn, or enable vision for this model in Settings.`,
      409
    );
  }


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

  // --- Privacy mode, policy gate, and credentials (Sections 3.3-3.6) -----
  const privacySettings = getPrivacySettings();
  const mode = (chat.privacyMode ?? "standard") as PrivacyMode;
  const ephemeral = chat.incognito || mode === "incognito";
  const redactEnabled = redactionActive(mode);
  const redactOptions = redactionOptionsFromSettings(privacySettings);
  const providerIsLocal = isLocalEndpoint(provider.baseUrl);
  const gate = policyGate({
    policy: policyOf(provider),
    providerLabel: provider.name,
    mode,
    minimum: privacySettings.minimumProviderPolicy,
    isLocalEndpoint: providerIsLocal,
  });

  if (mode === "local" && !providerIsLocal) {
    recordEgress({
      chatId,
      providerId: provider.id,
      kind: "provider",
      destination: (() => {
        try {
          return new URL(provider.baseUrl).hostname;
        } catch {
          return provider.baseUrl;
        }
      })(),
      label: `${provider.name} · ${model.externalId}`,
      mode,
      status: "blocked",
    });
    return jsonError(
      `Strict Local mode only allows loopback or private-network model endpoints, and "${provider.name}" points at a remote host. Switch this chat to Standard or Private, or point the provider at a local endpoint such as Ollama, LM Studio, or vLLM.`,
      409,
      { code: "strict-local", provider: { id: provider.id, name: provider.name }, options: gate.options }
    );
  }

  if (mode === "private" && !gate.allowed && !body.allowPolicyOnce) {
    recordEgress({
      chatId,
      providerId: provider.id,
      kind: "provider",
      destination: providerIsLocal ? "local" : (() => {
        try {
          return new URL(provider.baseUrl).hostname;
        } catch {
          return provider.baseUrl;
        }
      })(),
      label: `${provider.name} · ${model.externalId}`,
      mode,
      status: "blocked",
    });
    return jsonError(
      `Private mode blocked this send: ${gate.reasons.join(" ")} (Provider policy is user-declared and never verified by Conduit.)`,
      409,
      { code: "policy-gate", gate, policy: policyOf(provider), policyLabel: policyLabel(policyOf(provider), providerIsLocal) }
    );
  }

  // A tool selection sent with the turn is remembered on the chat.
  if (body.toolsEnabled !== undefined) {
    chat = updateChat(chatId, { toolsEnabled: body.toolsEnabled }) ?? chat;
  }

  // Credentials default to block-and-ask: never send a detected credential
  // unless the user explicitly allows it once (Section 3.6). This runs before
  // the turn is persisted, so a blocked send leaves no stray message behind.
  if (redactEnabled) {
    const scanParts: Array<{ kind: string; text?: string }> = [
      ...(typeof body.message === "string"
        ? [{ kind: "text", text: body.message }]
        : (body.message ?? []).map((part) => ({ kind: part.kind, text: part.text }))),
      ...(body.history ?? [])
        .flatMap((message) => message.content)
        .map((part) => ({ kind: part.kind, text: part.text })),
    ];
    const scanText = [chat.systemPrompt ?? "", ...scanParts.map((part) => part.text ?? "")].join("\n\n");
    const credentials = summarizeRedactions(credentialMatches(scanText, redactOptions)).items;
    if (credentials.length && !body.allowCredentials) {
      return jsonError(
        `This turn looks like it contains ${
          credentials.length === 1 ? "a credential" : "credentials"
        }. Conduit will not send ${
          credentials.length === 1 ? "it" : "them"
        } without your explicit permission. Allow once to send it, or remove it from the message.`,
        409,
        { code: "credentials", credentials }
      );
    }
  }

  // --- Place the new turn in the message tree ------------------------------
  let contextRows = getActivePath(chatId);
  let parentId: string | null = null;

  const incognito = ephemeral;
  let pendingUserParts: ContentPart[] | null = null;

  if (body.message && incognito) {
    pendingUserParts = toContentParts(body.message);
    parentId = null;
  } else if (body.message) {
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
    // Tie the uploaded files to the message that carried them.
    linkAttachments(chatId, userRow.id, parts);
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

  const branchIndex = incognito ? 0 : nextBranchIndex(chatId, parentId);
  const historyForModel: InternalMessage[] = incognito
    ? [
        ...(body.history ?? []).map((message) => ({ role: message.role, content: message.content as ContentPart[] })),
        ...(pendingUserParts ? [{ role: "user" as const, content: pendingUserParts }] : []),
      ]
    : contextRows.map((row) => ({ role: row.role, content: row.content ?? [] }));

  const baseSystemPrompt =
    body.systemPrompt ??
    chat.systemPrompt ??
    "You are a helpful assistant inside Conduit, a self-hosted chat client. Use the tools you are given when they help, and cite any URLs you rely on.";

  /** Everything layered onto the base prompt for this turn. */
  const contextBlocks: string[] = [];
  const profile = profileInstructions();
  if (profile) contextBlocks.push(profile);
  const style = styleInstructions(chat.styleId);
  if (style) contextBlocks.push(`Response style: ${style}`);

  // Built-in artifact instruction (M5): a self-contained deliverable can be
  // published as a versioned artifact the user previews beside the chat.
  contextBlocks.push(
    [
      "Artifacts: when a self-contained deliverable would genuinely help (a chart, a small HTML/JS demo, an SVG, a Mermaid diagram, or a long code sample), you may wrap it in an <artifact> block:",
      '<artifact identifier="short-slug" type="html|svg|mermaid|markdown|code|react" title="Human title">…content…</artifact>.',
      "Reuse the same identifier to publish a new version of an earlier artifact.",
      "Keep each artifact self-contained: no remote scripts, stylesheets, fonts, or network requests; inline anything it needs.",
      "Do not wrap ordinary prose or short inline code in <artifact> tags.",
    ].join(" ")
  );
  if (chat.projectId) {
    const project = getProject(chat.projectId);
    if (project?.instructions) contextBlocks.push(`Project instructions: ${project.instructions}`);
    const skillInstructions = activeSkillInstructions(chat.projectId);
    if (skillInstructions) contextBlocks.push(skillInstructions);
  }
  const lastUserText = (() => {
    const lastUser = [...contextRows].reverse().find((row) => row.role === "user");
    if (!lastUser) return typeof body.message === "string" ? body.message : "";
    return (lastUser.content ?? [])
      .map((part) => (part.kind === "text" ? part.text : part.kind === "document" ? part.text ?? "" : ""))
      .join("\n")
      .trim();
  })();

  // Memory has two halves: the model is told how to propose a fact, and the
  // facts already stored are recalled for this question. Incognito chats opt
  // out of both, and the whole feature is off unless it was switched on.
  if (memoryEnabled() && !incognito && mode !== "private") {
    contextBlocks.push(
      [
        "Memory: you can remember durable facts about the user across chats.",
        "Save one by wrapping it in a <memory> block, for example <memory>The user prefers concise answers.</memory>.",
        "Conduit stores those blocks in Settings and removes them from the transcript, so save at most one fact per turn, and only when it will still be useful later.",
      ].join(" ")
    );
  }

  if (memoryEnabled() && !incognito && mode !== "private" && lastUserText) {
    const memories = relevantMemories(lastUserText);
    if (memories.length) {
      contextBlocks.push(
        `Things you remember about this user (from earlier chats):\n${memories.map((memory) => `- ${memory}`).join("\n")}`
      );
    }
  }

  // Snapshotted for the stream closure: the fallback path may change the chat.
  const initialTitle = chat.title;
  const settings = {
    temperature: chat.temperature,
    topP: chat.topP,
    maxTokens: chat.maxTokens,
    thinkingBudget: chat.thinkingBudget ?? undefined,
  };

  // Tools are offered only when the model is not explicitly marked as
  // tool-incapable, and only for tools the user has configured.
  const toolCapable = model.capabilities?.toolCalling !== false;
  let enabledToolNames = toolCapable ? resolveToolNames(chat.toolsEnabled ?? undefined) : [];
  // Strict Local: keep only tools that never leave the machine (Section 3.3).
  if (mode === "local") enabledToolNames = enabledToolNames.filter((name) => isLocallyPermittedTool(name));
  const tools = enabledToolNames.length ? toolDefinitions(enabledToolNames) : undefined;

  // Create the assistant row up front so a dropped connection still leaves a saved
  // message. Incognito chats keep everything in memory instead.
  const assistantRow = incognito
    ? { id: `incognito-${Date.now().toString(36)}` }
    : appendMessage({
        chatId,
        role: "assistant",
        content: [],
        modelId: model.id,
        parentId,
        branchIndex,
      });
  if (!incognito) setActiveLeaf(chatId, assistantRow.id);

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
      let usedFallback = false;
      let reasoningStartedAt = 0;
      let reasoningEndedAt = 0;
      let history = [...historyForModel];

      const send = (event: OutgoingEvent) => controller.enqueue(encoder.encode(sseEncode(event)));

      /** Streams one provider turn and buffers the events (a fallback may need a retry). */
      const streamTurn = async (activeModel: typeof model, activeProvider: typeof provider) => {
        const adapter = getAdapter(activeProvider.apiFormat as never);
        const connection = connectionFromProvider(activeProvider);
        const events: StreamEvent[] = [];
        for await (const event of adapter.stream({
          ...connection,
          model: activeModel.externalId,
          system: systemPrompt,
          messages: history,
          temperature: body.temperature ?? settings.temperature,
          topP: body.topP ?? settings.topP,
          maxTokens: body.maxTokens ?? settings.maxTokens,
          thinkingBudget: body.thinkingBudget ?? settings.thinkingBudget,
          tools,
          signal: ac.signal,
        })) {
          events.push(event);
        }
        return events;
      };

      const pushText = (delta: string) => {
        const last = timeline[timeline.length - 1];
        if (last?.kind === "text") last.text += delta;
        else timeline.push({ kind: "text", text: delta });
      };

      let systemPrompt = contextBlocks.length ? `${baseSystemPrompt}\n\n${contextBlocks.join("\n\n")}` : baseSystemPrompt;
      let passages: RetrievedPassage[] = [];

      if (chat?.projectId && lastUserText) {
        try {
          const retrieval = await retrieveProjectContext(chat.projectId, lastUserText);
          passages = retrieval.passages;
          if (passages.length) {
            systemPrompt += `\n\nExcerpts from the project's knowledge base (cite the file names you use):\n${passages
              .map((passage, index) => `[${index + 1}] ${passage.file}\n${passage.content}`)
              .join("\n\n")}`;
            send({
              type: "sources",
              mode: retrieval.mode,
              sources: passages.map((passage) => ({
                title: passage.file,
                snippet: passage.content.slice(0, 240),
              })),
            });
          }
        } catch {
          /* retrieval is best effort */
        }
      }

      // --- Privacy pipeline: minimize → redact → (gate already applied) ---
      let redactionEntries: RedactionEntry[] = [];
      let redactionSummary: RedactionSummary | null = null;
      if (redactEnabled) {
        const historyResult = redactMessages(history, redactOptions);
        history = historyResult.messages as typeof history;
        redactionEntries = historyResult.entries;
        const systemResult = redactText(systemPrompt, redactOptions);
        systemPrompt = systemResult.text;
        redactionEntries = [...redactionEntries, ...systemResult.entries];
        redactionSummary = summarizeRedactions(redactionEntries);
      }
      const restorer = redactionEntries.length ? new PlaceholderRestorer(redactionEntries) : null;

      send({ type: "chat", chatId, title: initialTitle });
      send({ type: "message_ids", assistantMessageId: assistantRow.id });
      if (redactionSummary) send({ type: "redactions", summary: redactionSummary });

      // Deep Research: plan, search, fetch, then let the model write the report
      // from the numbered excerpts. The Stop button cancels every phase.
      if (body.research) {
        const step = (update: ResearchStep) => {
          if (!ac.signal.aborted) send({ type: "research_step", ...update });
        };

        if (!readToolsConfig().webSearch.enabled) {
          step({
            id: "plan",
            label: "Deep Research needs a search provider",
            status: "error",
            detail: "Turn on web search in Settings → Tools, then try again.",
          });
        } else {
          try {
            step({ id: "plan", label: "Planning the research", status: "running" });
            const queries = await planResearchQueries({
              question: lastUserText || "the user question",
              provider,
              model: model.externalId,
              signal: ac.signal,
            });
            step({
              id: "plan",
              label: "Planned the research",
              status: "done",
              detail: queries.map((query) => `“${query}”`).join(", "),
            });

            recordEgress({
              chatId,
              providerId: provider.id,
              kind: "search",
              destination: searchDestination(),
              label: `Deep Research (${queries.length} quer${queries.length === 1 ? "y" : "ies"})`,
              mode,
              payload: queries,
              status: "ok",
            });
            const sources = await gatherResearchSources({ queries, signal: ac.signal, onStep: step });

            if (sources.length) {
              systemPrompt += `\n\n${buildResearchContext(lastUserText, sources)}`;
              send({
                type: "research_sources",
                sources: sources.map((source) => ({
                  title: source.title,
                  url: source.url,
                  snippet: source.excerpt.slice(0, 300),
                })),
              });
              step({
                id: "gather",
                label: `Gathered ${sources.length} source${sources.length === 1 ? "" : "s"}`,
                status: "done",
              });
            } else {
              step({ id: "gather", label: "No sources could be gathered", status: "error" });
            }
          } catch (error) {
            step({
              id: "gather",
              label: "Research stopped",
              status: "error",
              detail: error instanceof Error ? error.message : "the research step failed",
            });
          }
        }
      }

      let round = 0;
      try {
        while (round < MAX_TOOL_ROUNDS) {
          round += 1;
          const pending = new Map<string, { name: string; input: unknown; args: string }>();
          const roundText: string[] = [];

          let roundEvents: StreamEvent[];
          try {
            roundEvents = await streamTurn(model, provider);
          } catch (error) {
            const fallback = fallbackModelFor(model);
            const canFallback =
              Boolean(fallback) &&
              !usedFallback &&
              !ac.signal.aborted &&
              error instanceof ProviderError &&
              error.retryable;
            if (!canFallback || !fallback) throw error;

            const fallbackProvider = getProvider(fallback.providerId);
            if (!fallbackProvider) throw error;

            usedFallback = true;
            send({
              type: "model_switch",
              modelLabel: fallback.displayName ?? fallback.externalId,
              reason: error.message,
            });
            model = fallback;
            provider = fallbackProvider;
            chat = updateChat(chatId, { modelId: fallback.id, providerId: fallbackProvider.id }) ?? chat;
            roundEvents = await streamTurn(model, provider);
          }

          for (const event of roundEvents) {
            if (event.type === "text_delta") {
              if (reasoningStartedAt && !reasoningEndedAt) reasoningEndedAt = Date.now();
              const text = restorer ? restorer.push(event.text) : event.text;
              if (!text) continue;
              roundText.push(text);
              textParts.push(text);
              pushText(text);
              send({ type: "text_delta", text });
              continue;
            }
            if (event.type === "reasoning_delta") {
              const text = restorer ? restorer.push(event.text) : event.text;
              if (!text) continue;
              reasoningParts.push(text);
              if (!reasoningStartedAt) reasoningStartedAt = Date.now();
              send({ type: "reasoning_delta", text });
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
              // A tool argument may carry a masked value; unmask it for this
              // approved call so the tool receives what the user meant.
              let input = event.input;
              if (redactionEntries.length) {
                try {
                  input = JSON.parse(restoreText(JSON.stringify(event.input), redactionEntries));
                } catch {
                  input = event.input;
                }
              }
              if (call) {
                call.input = input;
                call.args = "";
              }
              send({ type: "tool_call_end", id: event.id, input });
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
          let stopped = false;
          const markUse = (id: string, status: "success" | "error" | "awaiting_approval" | "denied", error?: string) => {
            const index = timeline.findIndex((part) => part.kind === "tool_use" && part.id === id);
            if (index < 0 || timeline[index].kind !== "tool_use") return;
            const part = timeline[index] as Extract<ContentPart, { kind: "tool_use" }>;
            timeline[index] = { ...part, status, ...(error ? { error: error.slice(0, 400) } : {}) };
          };

          for (const [id, call] of pending) {
            const spec = toolSpec(call.name);
            const egress = toolEgress(call.name);
            if (egress.kind === "thirdParty") {
              recordEgress({
                chatId,
                providerId: provider.id,
                kind: toolEgressKind(call.name),
                destination: egress.destination ?? "unknown",
                label: spec?.label ?? call.name,
                mode,
                payload: call.input,
                redactionCount: redactionEntries.length,
                status: "ok",
              });
            }
            let result: Awaited<ReturnType<typeof runTool>>;

            if (spec?.execution === "client") {
              // The browser runs this tool. The page posts the outcome to
              // /api/chat/tool-result, which unblocks waitForClientTool.
              markUse(id, "awaiting_approval");
              send({
                type: "tool_approval",
                id,
                name: call.name,
                label: spec.label,
                input: call.input,
                requiresApproval: spec.requiresApproval !== false && !readToolsConfig().code.autoApprove,
                execution: "client",
                egress,
              });

              const outcome = await waitForClientTool(id, { signal: ac.signal });
              if (outcome.status === "cancelled") {
                stopped = true;
                break;
              }

              if (outcome.status === "denied") {
                markUse(id, "denied", "Declined by the user.");
                result = { output: "The user declined to run this tool. Continue without its result.", isError: true };
              } else if (outcome.status === "timeout") {
                markUse(id, "error", "Timed out waiting for the user.");
                result = { output: "The tool timed out before it ran.", isError: true };
              } else {
                markUse(id, outcome.isError ? "error" : "success", outcome.isError ? outcome.output : undefined);
                result = { output: outcome.output, isError: outcome.isError };
              }
            } else if (spec?.requiresApproval && !readToolsConfig().code.autoApprove) {
              // A server-side tool the user asked to approve first (MCP servers
              // and custom HTTP tools can opt in). The page answers through the
              // same /api/chat/tool-result endpoint the code runners use.
              markUse(id, "awaiting_approval");
              send({
                type: "tool_approval",
                id,
                name: call.name,
                label: spec.label,
                input: call.input,
                requiresApproval: true,
                execution: "server",
                egress,
              });

              const decision = await waitForClientTool(id, { signal: ac.signal });
              if (decision.status === "cancelled") {
                stopped = true;
                break;
              }
              if (decision.status === "denied") {
                markUse(id, "denied", "Declined by the user.");
                result = { output: "The user declined to run this tool. Continue without its result.", isError: true };
              } else if (decision.status === "timeout") {
                markUse(id, "error", "Timed out waiting for the user.");
                result = { output: "The tool timed out before it ran.", isError: true };
              } else {
                send({ type: "tool_status", id, name: call.name, status: "running" });
                result = await runTool(call.name, call.input);
                markUse(id, result.isError ? "error" : "success", result.isError ? result.output : undefined);
              }
            } else {
              send({ type: "tool_status", id, name: call.name, status: "running" });
              result = await runTool(call.name, call.input);
              markUse(id, result.isError ? "error" : "success", result.isError ? result.output : undefined);
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
          if (stopped) break;
        }

        // Release any placeholder the provider left buffered at end of stream.
        if (restorer) {
          const tail = restorer.flush();
          if (tail) {
            textParts.push(tail);
            pushText(tail);
            send({ type: "text_delta", text: tail });
          }
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
        if (reasoningParts.length) {
          const endedAt = reasoningEndedAt || Date.now();
          content.push({
            kind: "thinking",
            text: reasoningParts.join(""),
            durationMs: reasoningStartedAt ? Math.max(0, endedAt - reasoningStartedAt) : undefined,
          });
        }
        content.push(...timeline);

        const promptTokens = usage.promptTokens ?? 0;
        const completionTokens = usage.completionTokens ?? 0;
        const cost = estimateCost(
          model.pricePerMillionInput,
          model.pricePerMillionOutput,
          promptTokens,
          completionTokens
        );

        // The model can propose facts with <memory>…</memory>; the transcript keeps
        // the plain answer, and the proposal is stored when memory is on.
        if (memoryEnabled() && !incognito && mode !== "private" && textParts.length) {
          const { proposals } = extractMemoryProposals(textParts.join(""));
          for (const proposal of proposals) {
            if (addMemory(proposal, chatId)) send({ type: "memory", fact: proposal });
          }
        }

        if (!incognito) {
          updateMessage(assistantRow.id, {
            content: stripMemoryTagsFromParts(content),
            tokenUsage: usage,
            cost,
            error: errored,
          });
        }
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

        recordEgress({
          chatId,
          providerId: provider.id,
          kind: "provider",
          destination: providerIsLocal
            ? "local"
            : (() => {
                try {
                  return new URL(provider.baseUrl).hostname;
                } catch {
                  return provider.baseUrl;
                }
              })(),
          label: `${provider.name} · ${model.externalId}`,
          mode,
          bytesOut: systemPrompt.length + history.reduce((total, message) => total + JSON.stringify(message.content).length, 0),
          redactionCount: redactionEntries.length,
          payload: { systemPromptChars: systemPrompt.length, messages: history.length, rounds: round },
          status: errored ? "error" : ac.signal.aborted ? "blocked" : "ok",
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
    return jsonOk({ defaultModel: getDefaultModel() ?? null, tools: resolveToolNames() });
  } catch (error) {
    return errorResponse(error);
  }
}
