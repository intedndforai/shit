import type { ContentPart } from "@/lib/db/schema";

/** Thin typed wrapper around the JSON endpoints. */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const message =
      (payload as { error?: string }).error ?? `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return payload as T;
}

export interface PublicProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: "openai-completions" | "openai-responses" | "anthropic" | "gemini";
  customHeaders: Record<string, string>;
  organizationId: string | null;
  projectId: string | null;
  hasApiKey: boolean;
  maskedApiKey: string;
  isDefault: boolean;
  modelCount: number;
}

export interface StoredModel {
  id: string;
  providerId: string;
  externalId: string;
  displayName: string | null;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: Record<string, boolean>;
  pricePerMillionInput: number;
  pricePerMillionOutput: number;
  isDefault: boolean;
  isFallback: boolean;
}

export interface ChatSummary {
  id: string;
  title: string | null;
  modelId: string | null;
  providerId: string | null;
  pinned: boolean;
  archived: boolean;
  updatedAt: number;
  createdAt: number;
  messageCount: number;
}

export interface ChatMessageDto {
  id: string;
  chatId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: ContentPart[];
  modelId: string | null;
  tokenUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  cost: number;
  error: string | null;
  createdAt: number;
}

export const api = {
  listProviders: () => request<{ providers: PublicProvider[] }>("/api/providers"),
  createProvider: (input: unknown) =>
    request<{ provider: PublicProvider }>("/api/providers", { method: "POST", body: JSON.stringify(input) }),
  updateProvider: (id: string, input: unknown) =>
    request<{ provider: PublicProvider }>(`/api/providers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteProvider: (id: string) => request<{ ok: true }>(`/api/providers/${id}`, { method: "DELETE" }),
  testProvider: (id: string, overrides?: unknown) =>
    request<{ ok: true; models: number }>(`/api/providers/${id}/test`, {
      method: "POST",
      body: JSON.stringify(overrides ?? {}),
    }),
  listModels: (providerId: string) =>
    request<{ models: StoredModel[] }>(`/api/providers/${providerId}/models`),
  discoverModels: (providerId: string) =>
    request<{ models: StoredModel[] }>(`/api/providers/${providerId}/models`, {
      method: "POST",
      body: JSON.stringify({ discover: true }),
    }),
  updateModel: (id: string, input: unknown) =>
    request<{ model: StoredModel }>(`/api/models/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

  listChats: () => request<{ chats: ChatSummary[] }>("/api/chats"),
  createChat: (input: unknown) =>
    request<{ chat: { id: string } }>("/api/chats", { method: "POST", body: JSON.stringify(input) }),
  getChat: (id: string) =>
    request<{ chat: ChatSummary & { systemPrompt: string | null; temperature: number; topP: number; maxTokens: number }; messages: ChatMessageDto[]; model: { id: string } | null }>(
      `/api/chats/${id}`
    ),
  updateChat: (id: string, input: unknown) =>
    request<{ chat: unknown }>(`/api/chats/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteChat: (id: string) => request<{ ok: true }>(`/api/chats/${id}`, { method: "DELETE" }),
};