"use client";

import { create } from "zustand";
import type { ContentPart } from "@/lib/db/schema";
import { useUIStore } from "@/lib/store/ui-store";
import {
  api,
  type ChatMessageDto,
  type ChatSummary,
  type PolicyGateDto,
  type RedactionSummaryDto,
  type RedactionSummaryItemDto,
} from "@/lib/api-client";
import type { PrivacyMode } from "@/lib/privacy/types";

/** Everything needed to re-send a blocked turn with a one-time override. */
interface PrivacyRetry {
  message?: string | ContentPart[];
  regenerate?: boolean;
  continueFromLeaf?: boolean;
  toolsEnabled?: string[] | null;
  modelId?: string | null;
  research?: boolean;
  history?: Array<{ role: "system" | "user" | "assistant" | "tool"; content: ContentPart[] }>;
}

/** A blocked send that the user can override once (Sections 3.4, 3.6). */
export interface PrivacyBlock {
  code: "credentials" | "policy-gate" | "strict-local";
  message: string;
  credentials?: RedactionSummaryItemDto[];
  gate?: PolicyGateDto;
  retry?: PrivacyRetry;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: ContentPart[];
  error?: string | null;
  createdAt: number;
  streaming?: boolean;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  cost?: number;
  parentId?: string | null;
  branchIndex?: number;
  siblingIndex?: number;
  siblingCount?: number;
  citations?: { title: string; url: string }[];
  /** Project knowledge-base excerpts used for this answer. */
  sources?: { title: string; snippet: string }[];
  /** How those excerpts were found: vector similarity or keyword ranking. */
  sourceMode?: "embeddings" | "keywords" | "none";
  /** Facts the model asked to remember while writing this answer. */
  memoryNotes?: string[];
  /** Deep Research progress timeline for this answer. */
  researchSteps?: Array<{ id: string; label: string; status: string; detail?: string }>;
  /** Sources Deep Research gathered before the answer was written. */
  researchSources?: Array<{ title: string; url: string; snippet: string }>;
  /** Values masked before this answer was requested (Private / Strict Local). */
  redactions?: RedactionSummaryDto;
}

interface ChatState {
  chats: ChatSummary[];
  chatId: string | null;
  chatTitle: string | null;
  chatTitleSource: "auto" | "model" | "user";
  chatModelLabel: string | null;
  /** Id of the model the open chat is pinned to (null for a brand-new chat). */
  chatModelId: string | null;
  /** Provider behind the open chat's model, for the destination badge. */
  chatProviderId: string | null;
  chatArchived: boolean;
  /** Model window and pricing, for the context meter and cost estimates. */
  chatContextWindow: number;
  chatPricing: { input: number; output: number };
  chatReasoningCapable: boolean;
  chatFallbackId: string | null;
  /** Per-chat generation controls (M7). */
  chatTemperature: number;
  chatTopP: number;
  chatMaxTokens: number;
  chatThinkingBudget: number | null;
  chatSystemPrompt: string | null;
  chatIncognito: boolean;
  chatPrivacyMode: PrivacyMode;
  chatStyleId: string | null;
  chatProjectId: string | null;
  /** Set when a retry had to fall back to another model. */
  modelNote: string | null;
  messages: UiMessage[];
  streaming: boolean;
  error: string | null;
  loading: boolean;
  editingId: string | null;
  /** Set when the privacy gate or credential guard stopped a send. */
  privacyBlock: PrivacyBlock | null;
  /** Clears the block and re-sends with an explicit one-time override. */
  retryPrivacyOverride: (add: { allowCredentials?: boolean; allowPolicyOnce?: boolean }) => Promise<void>;
  clearPrivacyBlock: () => void;

  loadChats: () => Promise<void>;
  openChat: (id: string | null) => Promise<void>;
  send: (text: string) => Promise<void>;
  regenerate: () => Promise<void>;
  editMessage: (id: string, text: string) => Promise<void>;
  switchBranch: (id: string, direction?: "prev" | "next" | "self") => Promise<void>;
  setEditing: (id: string | null) => void;
  stop: () => void;
  renameChat: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  toggleArchive: (id: string) => Promise<void>;
  removeChat: (id: string) => Promise<void>;
  refreshTitle: () => Promise<void>;
  updateChatSettings: (patch: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    thinkingBudget?: number | null;
    systemPrompt?: string | null;
  }) => Promise<void>;
  summarize: (mode?: "auto" | "summarize" | "truncate") => Promise<string | null>;
  updateChatMeta: (patch: {
    styleId?: string | null;
    projectId?: string | null;
    incognito?: boolean;
    privacyMode?: PrivacyMode;
    modelId?: string | null;
  }) => Promise<void>;
  newChat: (options?: {
    projectId?: string | null;
    incognito?: boolean;
    privacyMode?: PrivacyMode;
  }) => Promise<string | null>;
}

let activeController: AbortController | null = null;

function toUiMessage(message: ChatMessageDto): UiMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    error: message.error,
    createdAt: message.createdAt,
    usage: message.tokenUsage,
    cost: message.cost,
    parentId: message.parentId,
    branchIndex: message.branchIndex,
    siblingIndex: message.siblingIndex,
    siblingCount: message.siblingCount,
  };
}

export const useChatStore = create<ChatState>()((set, get) => ({
  chats: [],
  chatId: null,
  chatTitle: null,
  chatTitleSource: "auto",
  chatModelLabel: null,
  chatModelId: null,
  chatProviderId: null,
  chatArchived: false,
  chatContextWindow: 128000,
  chatPricing: { input: 0, output: 0 },
  chatReasoningCapable: false,
  chatFallbackId: null,
  chatTemperature: 0.7,
  chatTopP: 1,
  chatMaxTokens: 8192,
  chatThinkingBudget: null,
  chatSystemPrompt: null,
  chatIncognito: false,
  chatPrivacyMode: "standard",
  chatStyleId: null,
  chatProjectId: null,
  modelNote: null,
  messages: [],
  streaming: false,
  error: null,
  loading: false,
  editingId: null,
  privacyBlock: null,

  async loadChats() {
    try {
      const { chats } = await api.listChats();
      set({ chats });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not load chats." });
    }
  },

  async openChat(id) {
    if (!id) {
      set({
        chatId: null,
        chatTitle: null,
        chatTitleSource: "auto",
        chatModelLabel: null,
        chatModelId: null,
        chatProviderId: null,
        chatArchived: false,
        chatIncognito: false,
        chatPrivacyMode: "standard",
        chatStyleId: null,
        chatProjectId: null,
        modelNote: null,
        messages: [],
        error: null,
        editingId: null,
      });
      return;
    }
    set({ loading: true, error: null });
    try {
      const data = await api.getChat(id);
      set({
        chatId: id,
        chatTitle: data.chat.title,
        chatTitleSource: data.chat.titleSource,
        chatModelLabel: data.model ? data.model.displayName ?? data.model.externalId : null,
        chatModelId: data.chat.modelId ?? null,
        chatProviderId: data.chat.providerId ?? null,
        chatArchived: data.chat.archived,
        chatContextWindow: data.model?.contextWindow ?? 128000,
        chatPricing: {
          input: data.model?.pricePerMillionInput ?? 0,
          output: data.model?.pricePerMillionOutput ?? 0,
        },
        chatReasoningCapable: Boolean(data.model?.reasoningCapable),
        chatFallbackId: data.model?.fallbackId ?? null,
        chatTemperature: data.chat.temperature,
        chatTopP: data.chat.topP,
        chatMaxTokens: data.chat.maxTokens,
        chatThinkingBudget: data.chat.thinkingBudget,
        chatSystemPrompt: data.chat.systemPrompt,
        chatIncognito: data.chat.incognito || data.chat.privacyMode === "incognito",
        chatPrivacyMode: (data.chat.privacyMode ?? "standard") as PrivacyMode,
        chatStyleId: data.chat.styleId,
        chatProjectId: data.chat.projectId,
        messages: data.messages.map(toUiMessage),
        loading: false,
        editingId: null,
      });
      useUIStore.getState().clearToolRuns();
      useUIStore.getState().setPendingTools(data.chat.toolsEnabled ?? null);
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Could not open this chat.",
      });
    }
  },

  stop() {
    activeController?.abort();
    activeController = null;
    set({ streaming: false });
  },

  async send(text) {
    const trimmed = text.trim();
    const drafts = useUIStore
      .getState()
      .attachments.filter((attachment) => attachment.status === "ready");
    if ((!trimmed && !drafts.length) || get().streaming) return;

    const parts: ContentPart[] = [];
    if (trimmed) parts.push({ kind: "text", text: trimmed });
    for (const draft of drafts) {
      if (draft.kind === "image" && draft.dataUrl) {
        parts.push({
          kind: "image",
          dataUrl: draft.dataUrl,
          alt: draft.name,
          attachmentId: draft.serverId,
          url: draft.url,
        });
      } else if (draft.text) {
        parts.push({
          kind: "document",
          name: draft.name,
          mime: draft.mime,
          text: draft.text,
          attachmentId: draft.serverId,
          url: draft.url,
        });
      }
    }

    set({ editingId: null });
    useUIStore.getState().clearAttachments();

    const state = get();
    const incognito = state.chatIncognito;
    const pendingModelId = useUIStore.getState().pendingModelId;
    await runStream(set, get, {
      message: parts,
      toolsEnabled: useUIStore.getState().pendingTools,
      modelId: pendingModelId,
      research: useUIStore.getState().researchMode || undefined,
      // Incognito chats are never written to the database, so the tab sends the
      // transcript it is showing to keep multi-turn context.
      history: incognito
        ? state.messages
            .filter((message) => !message.streaming)
            .map((message) => ({ role: message.role, content: message.content }))
        : undefined,
    });
    if (pendingModelId) {
      useUIStore.getState().setPendingModelId(null);
      await get().updateChatMeta({ modelId: pendingModelId });
    }
  },

  async regenerate() {
    if (get().streaming) return;
    await runStream(set, get, { regenerate: true });
  },

  clearPrivacyBlock() {
    set({ privacyBlock: null });
  },

  async retryPrivacyOverride(add) {
    const block = get().privacyBlock;
    if (!block) return;
    set({ privacyBlock: null });
    await runStream(set, get, { ...(block.retry ?? {}), ...add });
  },

  async editMessage(id, text) {
    const trimmed = text.trim();
    if (!trimmed || get().streaming) return;
    set({ editingId: null });
    try {
      await api.editMessage(id, trimmed);
      await runStream(set, get, { continueFromLeaf: true });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not save your edit." });
    }
  },

  async switchBranch(id, direction = "self") {
    try {
      await api.switchBranch(id, direction);
      const current = get().chatId;
      if (current) await get().openChat(current);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not switch branch." });
    }
  },

  setEditing(id) {
    set({ editingId: id });
  },

  async renameChat(id, title) {
    await api.updateChat(id, { title });
    set((state) => ({
      chats: state.chats.map((chat) => (chat.id === id ? { ...chat, title } : chat)),
      ...(state.chatId === id ? { chatTitle: title } : {}),
    }));
  },

  async togglePin(id) {
    const chat = get().chats.find((item) => item.id === id);
    if (!chat) return;
    await api.updateChat(id, { pinned: !chat.pinned });
    await get().loadChats();
  },

  async toggleArchive(id) {
    const chat = get().chats.find((item) => item.id === id);
    if (!chat) return;
    await api.updateChat(id, { archived: !chat.archived });
    await get().loadChats();
  },

  async removeChat(id) {
    await api.deleteChat(id);
    set((state) => ({
      chats: state.chats.filter((chat) => chat.id !== id),
      ...(state.chatId === id ? { chatId: null, chatTitle: null, messages: [] } : {}),
    }));
  },

  async updateChatSettings(patch) {
    const id = get().chatId;
    set(() => ({
      ...(patch.temperature !== undefined ? { chatTemperature: patch.temperature } : {}),
      ...(patch.topP !== undefined ? { chatTopP: patch.topP } : {}),
      ...(patch.maxTokens !== undefined ? { chatMaxTokens: patch.maxTokens } : {}),
      ...(patch.thinkingBudget !== undefined ? { chatThinkingBudget: patch.thinkingBudget } : {}),
      ...(patch.systemPrompt !== undefined ? { chatSystemPrompt: patch.systemPrompt } : {}),
    }));
    if (!id) return;
    try {
      await api.updateChat(id, patch);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not save the chat settings." });
    }
  },

  async updateChatMeta(patch) {
    const id = get().chatId;
    set({
      ...(patch.modelId !== undefined ? { chatModelId: patch.modelId } : {}),
      ...(patch.styleId !== undefined ? { chatStyleId: patch.styleId } : {}),
      ...(patch.projectId !== undefined ? { chatProjectId: patch.projectId } : {}),
      ...(patch.incognito !== undefined ? { chatIncognito: patch.incognito } : {}),
      ...(patch.privacyMode !== undefined
        ? { chatPrivacyMode: patch.privacyMode, chatIncognito: patch.privacyMode === "incognito" }
        : {}),
    });
    if (!id) return;
    try {
      await api.updateChat(id, patch);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not save the chat." });
    }
  },

  async newChat(options = {}) {
    try {
      const { chat } = await api.createChat({
        projectId: options.projectId ?? null,
        incognito: options.incognito ?? options.privacyMode === "incognito",
        privacyMode: options.privacyMode,
      });
      await get().loadChats();
      await get().openChat(chat.id);
      return chat.id;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not start a new chat." });
      return null;
    }
  },

  async summarize(mode = "auto") {
    const id = get().chatId;
    if (!id) return null;
    try {
      const result = await api.summarizeChat(id, mode);
      await get().openChat(id);
      if (result.mode === "noop") return null;
      return result.mode === "summarized"
        ? `Summarized ${result.removed} earlier messages.`
        : `Trimmed ${result.removed} earlier messages.`;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not manage the context." });
      return null;
    }
  },

  async refreshTitle() {
    const id = get().chatId;
    if (!id) return;
    try {
      const { title } = await api.generateTitle(id);
      if (!title) return;
      set((state) => ({
        chatTitle: title,
        chatTitleSource: "model",
        chats: state.chats.map((chat) => (chat.id === id ? { ...chat, title } : chat)),
      }));
    } catch {
      /* titles are best-effort */
    }
  },
}));

type Setter = (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void;
type Getter = () => ChatState;

async function runStream(
  set: Setter,
  get: Getter,
  payload: {
    message?: string | ContentPart[];
    regenerate?: boolean;
    continueFromLeaf?: boolean;
    toolsEnabled?: string[] | null;
    modelId?: string | null;
    research?: boolean;
    history?: Array<{ role: "system" | "user" | "assistant" | "tool"; content: ContentPart[] }>;
    allowCredentials?: boolean;
    allowPolicyOnce?: boolean;
  }
): Promise<void> {
  const state = get();
  const controller = new AbortController();
  activeController = controller;

  const optimisticUser: UiMessage | null = payload.message
    ? {
        id: `local-user-${Date.now()}`,
        role: "user",
        content:
          typeof payload.message === "string"
            ? [{ kind: "text", text: payload.message }]
            : payload.message,
        createdAt: Date.now(),
      }
    : null;

  const streamingId = `local-assistant-${Date.now()}`;
  const streamingMessage: UiMessage = {
    id: streamingId,
    role: "assistant",
    content: [],
    createdAt: Date.now(),
    streaming: true,
  };

  set({
    messages: [...state.messages, ...(optimisticUser ? [optimisticUser] : []), streamingMessage],
    streaming: true,
    error: null,
    modelNote: null,
  });

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: get().chatId,
        message: payload.message,
        regenerate: payload.regenerate,
        continueFromLeaf: payload.continueFromLeaf,
        toolsEnabled: payload.toolsEnabled,
        modelId: payload.modelId ?? undefined,
        research: payload.research,
        history: payload.history,
        allowCredentials: payload.allowCredentials,
        allowPolicyOnce: payload.allowPolicyOnce,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text();
      let message = `Request failed (${response.status}).`;
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(detail) as Record<string, unknown>;
        message = (body.error as string) ?? message;
      } catch {
        /* keep the default message */
      }
      const code = typeof body.code === "string" ? body.code : null;
      if (code === "credentials" || code === "policy-gate" || code === "strict-local") {
        set({
          privacyBlock: {
            code,
            message,
            credentials: Array.isArray(body.credentials)
              ? (body.credentials as RedactionSummaryItemDto[])
              : undefined,
            gate: (body.gate as PolicyGateDto | undefined) ?? undefined,
            retry: {
              message: payload.message,
              regenerate: payload.regenerate,
              continueFromLeaf: payload.continueFromLeaf,
              history: payload.history,
              toolsEnabled: payload.toolsEnabled,
              modelId: payload.modelId,
              research: payload.research,
            },
          },
        });
      }
      throw new Error(message);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantId: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let index = buffer.indexOf("\n\n");
      while (index !== -1) {
        const chunk = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
        if (!chunk.startsWith("data:")) continue;

        const event = JSON.parse(chunk.slice(5).trim()) as Record<string, unknown>;
        if (event.type === "message_ids" && typeof event.assistantMessageId === "string") {
          assistantId = event.assistantMessageId;
        }
        handleEvent(event, streamingId, set, get);
      }
    }

    // Reconcile with the server (real ids, branch metadata) once the stream
    // ends. Incognito chats have no server copy, so the tab keeps what it
    // streamed and the transient excerpts stay attached to the visible answer.
    const chatId = get().chatId;
    if (chatId && !get().chatIncognito) {
      const data = await api.getChat(chatId);
      set({
        messages: carryLocalAnnotations(
          data.messages.map(toUiMessage),
          get().messages
        ),
        chatTitle: data.chat.title,
        chatTitleSource: data.chat.titleSource,
        chatModelLabel: data.model ? data.model.displayName ?? data.model.externalId : null,
        chatModelId: data.chat.modelId ?? null,
        chatProviderId: data.chat.providerId ?? null,
        chatArchived: data.chat.archived,
      });
    }
    void assistantId;
  } catch (error) {
    const aborted = controller.signal.aborted;
    if (!aborted) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      set((current) => ({
        error: message,
        messages: current.messages.map((item) =>
          item.id === streamingId ? { ...item, error: message, streaming: false } : item
        ),
      }));
    } else {
      const chatId = get().chatId;
      if (chatId && !get().chatIncognito) {
        try {
          const data = await api.getChat(chatId);
          set({ messages: data.messages.map(toUiMessage) });
        } catch {
          /* keep the partial stream on screen */
        }
      }
    }
  } finally {
    activeController = null;
    set((current) => ({
      streaming: false,
      messages: current.messages.map((item) =>
        item.id === streamingId ? { ...item, streaming: false } : item
      ),
    }));
    await get().loadChats();

    const state2 = get();
    // A placeholder title is replaced once the first answer exists, unless the
    // user renamed the chat or a title model already ran.
    if (state2.chatId && state2.chatTitleSource === "auto" && !state2.chatIncognito) {
      void state2.refreshTitle();
    }
    if (!state2.chatId) {
      // A brand new chat was created server-side; pick it up.
      const chats = state2.chats;
      if (chats.length) {
        await state2.openChat(chats[0].id);
      }
    }
  }
}

function handleEvent(event: Record<string, unknown>, streamingId: string, set: Setter, get: Getter): void {
  const type = event.type as string;

  if (type === "chat") {
    const chatId = (event.chatId as string) ?? get().chatId;
    set({ chatId, chatTitle: (event.title as string) ?? get().chatTitle });
    return;
  }

  const update = (mutate: (message: UiMessage) => UiMessage) =>
    set((current) => ({
      messages: current.messages.map((item) => (item.id === streamingId ? mutate(item) : item)),
    }));

  if (type === "text_delta") {
    update((message) => {
      const parts = [...message.content];
      const last = parts[parts.length - 1];
      if (last?.kind === "text") {
        parts[parts.length - 1] = { kind: "text", text: last.text + (event.text as string) };
      } else {
        parts.push({ kind: "text", text: event.text as string });
      }
      return { ...message, content: parts };
    });
    return;
  }

  if (type === "reasoning_delta") {
    update((message) => {
      const parts = [...message.content];
      const thinking = parts.find((part) => part.kind === "thinking");
      if (thinking && thinking.kind === "thinking") {
        const index = parts.indexOf(thinking);
        parts[index] = { kind: "thinking", text: thinking.text + (event.text as string) };
      } else {
        parts.unshift({ kind: "thinking", text: event.text as string });
      }
      return { ...message, content: parts };
    });
    return;
  }

  if (type === "redactions") {
    const summary = event.summary as RedactionSummaryDto | undefined;
    if (summary) update((message) => ({ ...message, redactions: summary }));
    return;
  }

  if (type === "usage") {
    update((message) => ({ ...message, usage: event.usage as UiMessage["usage"] }));
    return;
  }

  if (type === "sources") {
    const sources = Array.isArray(event.sources)
      ? (event.sources as Array<{ title: string; snippet: string }>)
      : [];
    update((message) => ({
      ...message,
      sources,
      sourceMode: (event.mode as UiMessage["sourceMode"]) ?? message.sourceMode,
    }));
    return;
  }

  if (type === "research_step") {
    const step = {
      id: String(event.id ?? "step"),
      label: String(event.label ?? "Researching"),
      status: String(event.status ?? "running"),
      detail: typeof event.detail === "string" ? event.detail : undefined,
    };
    update((message) => {
      const steps = message.researchSteps ?? [];
      const index = steps.findIndex((item) => item.id === step.id);
      return {
        ...message,
        researchSteps: index < 0 ? [...steps, step] : steps.map((item) => (item.id === step.id ? step : item)),
      };
    });
    return;
  }

  if (type === "research_sources") {
    const sources = Array.isArray(event.sources)
      ? (event.sources as Array<{ title: string; url: string; snippet: string }>)
      : [];
    update((message) => ({ ...message, researchSources: sources }));
    return;
  }

  if (type === "memory") {
    const fact = event.fact as string;
    if (fact) {
      update((message) => ({ ...message, memoryNotes: [...(message.memoryNotes ?? []), fact] }));
    }
    return;
  }

  if (type === "model_switch") {
    const label = (event.modelLabel as string) ?? "the fallback model";
    set({ modelNote: `The chosen model failed, so Conduit retried with ${label}.` });
    return;
  }

  if (type === "error") {
    update((message) => ({ ...message, error: (event.message as string) ?? "Provider error." }));
    return;
  }

  if (type === "tool_call_end") {
    const id = event.id as string;
    const input = event.input;
    update((message) => ({
      ...message,
      content: [
        ...message.content,
        { kind: "tool_use", id, name: (event.name as string) ?? "tool", input, status: "running" },
      ],
    }));
    return;
  }

  if (type === "tool_approval") {
    const id = event.id as string;
    const name = (event.name as string) ?? "tool";
    const input = event.input;

    // tool_call_end already added the card; just move it to "awaiting approval".
    update((message) => {
      const parts = message.content.map((part) =>
        part.kind === "tool_use" && part.id === id ? { ...part, status: "awaiting_approval" as const } : part
      );
      const exists = parts.some((part) => part.kind === "tool_use" && part.id === id);
      return {
        ...message,
        content: exists
          ? parts
          : [...parts, { kind: "tool_use" as const, id, name, input, status: "awaiting_approval" as const }],
      };
    });

    useUIStore.getState().startToolRun({
      id,
      name,
      label: (event.label as string) ?? name,
      input,
      requiresApproval: Boolean(event.requiresApproval),
      egress: event.egress as { kind: string; destination?: string; note?: string } | undefined,
      execution: (event.execution as "server" | "client") ?? "client",
      status: "approval",
      stdout: "",
      stderr: "",
      figures: [],
      files: [],
    });
    return;
  }

  if (type === "tool_status") {
    const id = event.id as string;
    const status = event.status as "running" | "success" | "error";
    update((message) => ({
      ...message,
      content: message.content.map((part) =>
        part.kind === "tool_use" && part.id === id && part.status !== "denied"
          ? { ...part, status }
          : part
      ),
    }));
    return;
  }

  if (type === "tool_result") {
    const id = event.id as string;
    const citations = Array.isArray(event.citations)
      ? (event.citations as Array<{ title: string; url: string }>)
      : [];
    update((message) => ({
      ...message,
      content: [
        ...message.content,
        {
          kind: "tool_result",
          id,
          output: (event.output as string) ?? "",
          isError: Boolean(event.isError),
        },
      ],
      citations: citations.length ? [...(message.citations ?? []), ...citations] : message.citations,
    }));
  }
}

/**
 * The server stores messages, not the transient excerpts, citations, or memory
 * notes that arrive on the stream. Carry those onto the reconciled answers.
 */
function carryLocalAnnotations(next: UiMessage[], local: UiMessage[]): UiMessage[] {
  const localAssistants = local.filter((message) => message.role === "assistant");
  let index = 0;
  return next.map((message) => {
    if (message.role !== "assistant") return message;
    const source = localAssistants[index];
    index += 1;
    if (!source) return message;
    return {
      ...message,
      ...(source.sources?.length ? { sources: source.sources, sourceMode: source.sourceMode } : {}),
      ...(source.citations?.length ? { citations: source.citations } : {}),
      ...(source.memoryNotes?.length ? { memoryNotes: source.memoryNotes } : {}),
      ...(source.redactions ? { redactions: source.redactions } : {}),
      ...(source.researchSteps?.length ? { researchSteps: source.researchSteps } : {}),
      ...(source.researchSources?.length ? { researchSources: source.researchSources } : {}),
    };
  });
}

export function textOf(message: UiMessage): string {
  return message.content
    .map((part) => (part.kind === "text" ? part.text : ""))
    .filter(Boolean)
    .join("");
}

export function thinkingOf(message: UiMessage): string {
  return message.content
    .map((part) => (part.kind === "thinking" ? part.text : ""))
    .filter(Boolean)
    .join("");
}