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

async function upload<T>(url: string, form: FormData): Promise<T> {
  const response = await fetch(url, { method: "POST", body: form });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const message = (payload as { error?: string }).error ?? `Upload failed with status ${response.status}.`;
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
  parentId: string | null;
  branchIndex: number;
  siblingIndex: number;
  siblingCount: number;
  modelId: string | null;
  tokenUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  cost: number;
  error: string | null;
  createdAt: number;
}

export interface ChatDetail {
  chat: {
    id: string;
    title: string | null;
    titleSource: "auto" | "model" | "user";
    systemPrompt: string | null;
    providerId: string | null;
    modelId: string | null;
    temperature: number;
    topP: number;
    maxTokens: number;
    thinkingBudget: number | null;
    toolsEnabled: string[] | null;
    pinned: boolean;
    archived: boolean;
    activeLeafId: string | null;
    createdAt: number;
    updatedAt: number;
  };
  messages: ChatMessageDto[];
  model: { id: string; externalId: string; displayName: string | null } | null;
  provider: { id: string; name: string; apiFormat: string } | null;
}

export type ArtifactKind = "html" | "react" | "svg" | "mermaid" | "markdown" | "code";

export interface ArtifactDto {
  id: string;
  chatId: string;
  messageId: string | null;
  identifier: string;
  type: ArtifactKind;
  title: string | null;
  content: string;
  version: number;
  createdAt: number;
  versionCount: number;
}

export interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: string;
  text?: string;
  dataUrl?: string;
  truncated: boolean;
  url: string;
  createdAt: number;
}

export interface SearchHit {
  chatId: string;
  messageId: string | null;
  chatTitle: string | null;
  role: string | null;
  snippet: string;
  updatedAt: number;
}

export interface ToolSpecDto {
  name: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  requiresConfig: boolean;
  configured: boolean;
  /** "client" tools run in the browser and need the page to post their result. */
  execution: "server" | "client";
  requiresApproval: boolean;
  parameters: Record<string, unknown>;
}

export interface ToolsState {
  config: {
    webSearch: { enabled: boolean; provider: "tavily" | "brave" | "serper" | "searxng"; baseUrl?: string; maxResults: number };
    fetch: { enabled: boolean };
    code: { autoApprove: boolean };
  };
  hasSearchApiKey: boolean;
  maskedSearchApiKey: string;
  available: string[];
  specs: ToolSpecDto[];
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
  getChat: (id: string) => request<ChatDetail>(`/api/chats/${id}`),
  updateChat: (id: string, input: unknown) =>
    request<{ chat: unknown }>(`/api/chats/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteChat: (id: string) => request<{ ok: true }>(`/api/chats/${id}`, { method: "DELETE" }),
  generateTitle: (id: string) =>
    request<{ title: string | null; generated: boolean }>(`/api/chats/${id}/title`, { method: "POST" }),

  switchBranch: (messageId: string, direction: "prev" | "next" | "self" = "self") =>
    request<{ ok: true; activeLeafId: string; messageId: string }>(`/api/messages/${messageId}/switch`, {
      method: "POST",
      body: JSON.stringify({ direction }),
    }),
  editMessage: (messageId: string, text: string) =>
    request<{ ok: true; messageId: string }>(`/api/messages/${messageId}/edit`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  search: (query: string) =>
    request<{ query: string; hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}`),

  importChat: (payload: unknown) =>
    request<{ chatId: string; imported: number }>("/api/chats/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  exportUrl: (chatId: string, format: "md" | "json") => `/api/chats/${chatId}/export?format=${format}`,

  uploadFile: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return upload<{ file: UploadedFile }>("/api/files", form);
  },
  getFileUrl: (id: string) => `/api/files/${id}`,

  postToolResult: (input: { id: string; decision?: "run" | "deny"; output?: string; isError?: boolean }) =>
    request<{ ok: true }>("/api/chat/tool-result", { method: "POST", body: JSON.stringify(input) }),

  getTools: () => request<ToolsState>("/api/tools"),
  updateTools: (input: unknown) => request<ToolsState>("/api/tools", { method: "PATCH", body: JSON.stringify(input) }),

  listArtifacts: (chatId?: string) =>
    request<{ artifacts: ArtifactDto[] }>(`/api/artifacts${chatId ? `?chatId=${chatId}` : ""}`),
  getArtifact: (id: string) =>
    request<{ artifact: ArtifactDto; versions: ArtifactDto[] }>(`/api/artifacts/${id}`),
};