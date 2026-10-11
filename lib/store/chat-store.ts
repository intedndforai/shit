"use client";

import { create } from "zustand";
import type { ContentPart } from "@/lib/db/schema";
import { api, type ChatSummary } from "@/lib/api-client";

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: ContentPart[];
  error?: string | null;
  createdAt: number;
  streaming?: boolean;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  cost?: number;
}

interface ChatState {
  chats: ChatSummary[];
  chatId: string | null;
  messages: UiMessage[];
  streaming: boolean;
  error: string | null;
  loading: boolean;

  loadChats: () => Promise<void>;
  openChat: (id: string | null) => Promise<void>;
  send: (text: string) => Promise<void>;
  regenerate: () => Promise<void>;
  stop: () => void;
  renameChat: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  removeChat: (id: string) => Promise<void>;
}

let activeController: AbortController | null = null;

function textOf(message: UiMessage): string {
  return message.content
    .map((part) => (part.kind === "text" ? part.text : ""))
    .filter(Boolean)
    .join("");
}

function thinkingOf(message: UiMessage): string {
  return message.content
    .map((part) => (part.kind === "thinking" ? part.text : ""))
    .filter(Boolean)
    .join("");
}

export const useChatStore = create<ChatState>()((set, get) => ({
  chats: [],
  chatId: null,
  messages: [],
  streaming: false,
  error: null,
  loading: false,

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
      set({ chatId: null, messages: [], error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const data = await api.getChat(id);
      set({
        chatId: id,
        messages: data.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          error: message.error,
          createdAt: message.createdAt,
          usage: message.tokenUsage,
          cost: message.cost,
        })),
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : "Could not open this chat." });
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
    await runStream(set, get, { message: trimmed });
  },

  async regenerate() {
    if (get().streaming) return;
    await runStream(set, get, { regenerate: true });
  },

  async renameChat(id, title) {
    await api.updateChat(id, { title });
    set((state) => ({ chats: state.chats.map((chat) => (chat.id === id ? { ...chat, title } : chat)) }));
  },

  async togglePin(id) {
    const chat = get().chats.find((item) => item.id === id);
    if (!chat) return;
    await api.updateChat(id, { pinned: !chat.pinned });
    await get().loadChats();
  },

  async removeChat(id) {
    await api.deleteChat(id);
    set((state) => ({
      chats: state.chats.filter((chat) => chat.id !== id),
      ...(state.chatId === id ? { chatId: null, messages: [] } : {}),
    }));
  },
}));

type Setter = (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void;
type Getter = () => ChatState;

/** Shared streaming routine used by both send and regenerate. */
async function runStream(
  set: Setter,
  get: Getter,
  payload: { message?: string; regenerate?: boolean }
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

  const base = payload.regenerate ? dropLastAssistant(state.messages) : state.messages;
  set({
    messages: [...(optimisticUser ? [...base, optimisticUser] : base), streamingMessage],
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
        handleEvent(event, streamingId, set, get);
      }
    }
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
  }
}

function dropLastAssistant(messagesList: UiMessage[]): UiMessage[] {
  const copy = [...messagesList];
  for (let i = copy.length - 1; i >= 0; i -= 1) {
    if (copy[i].role === "assistant") {
      copy.splice(i, 1);
      break;
    }
  }
  return copy;
}

function handleEvent(
  event: Record<string, unknown>,
  streamingId: string,
  set: Setter,
  get: Getter
): void {
  const type = event.type as string;

  if (type === "chat") {
    set({ chatId: (event.chatId as string) ?? get().chatId });
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

export { textOf, thinkingOf };