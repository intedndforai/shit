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

/** A model with the provider it came from; used by the @-mention picker. */
export interface ModelOptionDto {
  id: string;
  providerId: string;
  providerName: string;
  externalId: string;
  displayName: string | null;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: Record<string, boolean>;
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
    styleId: string | null;
    projectId: string | null;
    incognito: boolean;
    pinned: boolean;
    archived: boolean;
    activeLeafId: string | null;
    createdAt: number;
    updatedAt: number;
  };
  messages: ChatMessageDto[];
  model: {
    id: string;
    externalId: string;
    displayName: string | null;
    contextWindow: number;
    maxOutputTokens: number;
    pricePerMillionInput: number;
    pricePerMillionOutput: number;
    reasoningCapable: boolean;
    fallbackId: string | null;
  } | null;
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

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  fileCount: number;
  chatCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectFileDto {
  id: string;
  name: string;
  mimeType: string | null;
  size: number;
  status: string;
  chunkCount: number;
  createdAt: number;
}

export interface MemoryDto {
  id: string;
  content: string;
  sourceChatId: string | null;
  createdAt: number;
}

export interface StyleDto {
  id: string;
  name: string;
  slug: string;
  instructions: string;
  builtin: boolean;
}

export interface PromptDto {
  id: string;
  name: string;
  command: string;
  content: string;
  builtin: boolean;
}

/** Which model serves each optional job; null means "use the default". */
export interface RoleAssignmentsDto {
  title: string | null;
  summarization: string | null;
  embeddings: string | null;
}

export interface ProfileDto {
  name: string;
  role: string;
  instructions: string;
}

export interface StoredPreset {
  id: string;
  name: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  thinkingBudget: number | null;
  systemPrompt?: string | null;
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
  /** Every stored model across providers, for the @-mention picker. */
  listAllModels: () => request<{ models: ModelOptionDto[] }>("/api/models"),
  discoverModels: (providerId: string) =>
    request<{ models: StoredModel[] }>(`/api/providers/${providerId}/models`, {
      method: "POST",
      body: JSON.stringify({ discover: true }),
    }),
  updateModel: (id: string, input: unknown) =>
    request<{ model: StoredModel }>(`/api/models/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

  listChats: () => request<{ chats: ChatSummary[] }>("/api/chats"),
  createChat: (input: {
    title?: string | null;
    providerId?: string | null;
    modelId?: string | null;
    systemPrompt?: string | null;
    projectId?: string | null;
    styleId?: string | null;
    incognito?: boolean;
  }) =>
    request<{ chat: { id: string } }>("/api/chats", { method: "POST", body: JSON.stringify(input) }),
  getChat: (id: string) => request<ChatDetail>(`/api/chats/${id}`),
  updateChat: (id: string, input: unknown) =>
    request<{ chat: unknown }>(`/api/chats/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteChat: (id: string) => request<{ ok: true }>(`/api/chats/${id}`, { method: "DELETE" }),
  summarizeChat: (id: string, mode: "auto" | "summarize" | "truncate" = "auto") =>
    request<{ mode: "summarized" | "truncated" | "noop"; removed: number; kept: number; reason?: string }>(
      `/api/chats/${id}/summarize`,
      { method: "POST", body: JSON.stringify({ mode }) }
    ),
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

  listPresets: () => request<{ presets: StoredPreset[] }>("/api/presets"),
  savePresets: (presets: StoredPreset[]) =>
    request<{ presets: StoredPreset[] }>("/api/presets", { method: "PUT", body: JSON.stringify({ presets }) }),

  postToolResult: (input: { id: string; decision?: "run" | "deny"; output?: string; isError?: boolean }) =>
    request<{ ok: true }>("/api/chat/tool-result", { method: "POST", body: JSON.stringify(input) }),

  getTools: () => request<ToolsState>("/api/tools"),
  updateTools: (input: unknown) => request<ToolsState>("/api/tools", { method: "PATCH", body: JSON.stringify(input) }),

  listArtifacts: (chatId?: string) =>
    request<{ artifacts: ArtifactDto[] }>(`/api/artifacts${chatId ? `?chatId=${chatId}` : ""}`),
  getArtifact: (id: string) =>
    request<{ artifact: ArtifactDto; versions: ArtifactDto[] }>(`/api/artifacts/${id}`),

  /* --- Projects, memory, personalization (M8) ---------------------------- */
  listProjects: () => request<{ projects: ProjectDto[] }>("/api/projects"),
  createProject: (input: { name: string; description?: string | null; instructions?: string | null }) =>
    request<{ project: ProjectDto }>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  getProject: (id: string) =>
    request<{
      project: ProjectDto;
      files: ProjectFileDto[];
      chats: Array<{ id: string; title: string | null; updatedAt: number }>;
      stats: { files: number; chunks: number; embedded: number };
    }>(`/api/projects/${id}`),
  updateProject: (id: string, patch: unknown) =>
    request<{ project: ProjectDto }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteProject: (id: string) => request<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" }),
  attachProjectFile: (id: string, input: { attachmentId?: string; name?: string; text?: string }) =>
    request<{ file: ProjectFileDto; embedded: boolean }>(`/api/projects/${id}/files`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteProjectFile: (id: string, fileId: string) =>
    request<{ ok: true }>(`/api/projects/${id}/files?fileId=${encodeURIComponent(fileId)}`, { method: "DELETE" }),

  getMemory: () => request<{ enabled: boolean; memories: MemoryDto[] }>("/api/memories"),
  setMemoryEnabled: (enabled: boolean) =>
    request<{ enabled: boolean; memories: MemoryDto[] }>("/api/memories", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  addMemory: (content: string) =>
    request<{ memory: MemoryDto | null; memories: MemoryDto[] }>("/api/memories", {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  updateMemory: (id: string, content: string) =>
    request<{ memory: MemoryDto; memories: MemoryDto[] }>(`/api/memories/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
  deleteMemory: (id: string) =>
    request<{ ok: true; memories: MemoryDto[] }>(`/api/memories/${id}`, { method: "DELETE" }),

  listStyles: () => request<{ styles: StyleDto[] }>("/api/styles"),
  createStyle: (input: { name: string; instructions: string }) =>
    request<{ style: StyleDto }>("/api/styles", { method: "POST", body: JSON.stringify(input) }),
  updateStyle: (id: string, patch: { name?: string; instructions?: string }) =>
    request<{ style: StyleDto }>(`/api/styles/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteStyle: (id: string) => request<{ ok: true }>(`/api/styles/${id}`, { method: "DELETE" }),
  styleFromSample: (sample: string) =>
    request<{ instructions: string }>("/api/styles/from-sample", { method: "POST", body: JSON.stringify({ sample }) }),

  listPrompts: () => request<{ prompts: PromptDto[] }>("/api/prompts"),
  createPrompt: (input: { name: string; command: string; content: string }) =>
    request<{ prompt: PromptDto }>("/api/prompts", { method: "POST", body: JSON.stringify(input) }),
  updatePrompt: (id: string, patch: { name?: string; content?: string }) =>
    request<{ prompt: PromptDto }>(`/api/prompts/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deletePrompt: (id: string) => request<{ ok: true }>(`/api/prompts/${id}`, { method: "DELETE" }),

  getRoles: () => request<{ assignments: RoleAssignmentsDto; models: ModelOptionDto[] }>("/api/roles"),
  saveRoles: (patch: Partial<RoleAssignmentsDto>) =>
    request<{ assignments: RoleAssignmentsDto; models: ModelOptionDto[] }>("/api/roles", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  getProfile: () => request<{ profile: ProfileDto }>("/api/profile"),
  saveProfile: (profile: ProfileDto) =>
    request<{ profile: ProfileDto }>("/api/profile", { method: "PUT", body: JSON.stringify(profile) }),
};