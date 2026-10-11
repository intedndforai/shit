"use client";

import { create } from "zustand";
import type { ContentPart } from "@/lib/db/schema";
import { api, type ChatMessageDto, type ChatSummary } from "@/lib/api-client";

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
}

interface ChatState {
  chats: ChatSummary[];
  chatId: string | null;
  chatTitle: string | null;
  chatTitleSource: "auto" | "model" | "user";
  chatModelLabel: string | null;
  chatArchived: boolean;
  messages: UiMessage[];
  streaming: boolean;
  error: string | null;
  loading: boolean;
  editingId: string | null;

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
  chatArchived: false,
  messages: [],
  streaming: false,
  error: null,
  loading: false,
  editingId: null,

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
        chatArchived: false,
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
        chatArchived: data.chat.archived,
        messages: data.messages.map(toUiMessage),
        loading: false,
        editingId: null,
      });
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
    if (!trimmed || get().streaming) return;
    set({ editingId: null });
    await runStream(set, get, { message: trimmed });
  },

  async regenerate() {
    if (get().streaming) return;
    await runStream(set, get, { regenerate: true });
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
  payload: { message?: string; regenerate?: boolean; continueFromLeaf?: boolean }
): Promise<void> {
  const state = get();
  const controller = new AbortController();
  activeController = controller;

  const optimisticUser: UiMessage | null = payload.message
    ? {
        id: `local-user-${Date.now()}`,
        role: "user",
        content: [{ kind: "text", text: payload.message }],
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
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text();
      let message = `Request failed (${response.status}).`;
      try {
        message = (JSON.parse(detail) as { error?: string }).error ?? message;
      } catch {
        /* keep the default message */
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

    // Reconcile with the server (real ids, branch metadata) once the stream ends.
    const chatId = get().chatId;
    if (chatId) {
      const data = await api.getChat(chatId);
      set({
        messages: data.messages.map(toUiMessage),
        chatTitle: data.chat.title,
        chatTitleSource: data.chat.titleSource,
        chatModelLabel: data.model ? data.model.displayName ?? data.model.externalId : null,
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
      if (chatId) {
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
    if (state2.chatId && state2.chatTitleSource === "auto") {
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

  if (type === "usage") {
    update((message) => ({ ...message, usage: event.usage as UiMessage["usage"] }));
    return;
  }

  if (type === "error") {
    update((message) => ({ ...message, error: (event.message as string) ?? "Provider error." }));
  }
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