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

async function upload<T>(
  url: string,
  form: FormData,
  onProgress?: (percent: number) => void
): Promise<T> {
  // XMLHttpRequest rather than fetch so the composer can show real upload
  // progress; fetch still has no portable upload-progress event.
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      let payload: unknown = {};
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        payload = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(payload as T);
        return;
      }
      const message =
        (payload as { error?: string }).error ??
        (xhr.status === 0 ? "The upload could not reach the server." : `Upload failed with status ${xhr.status}.`);
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("The upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("The upload was cancelled."));
    xhr.send(form);
  });
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
  dataPolicyTraining: string;
  dataPolicyRetention: string;
  dataPolicyRegion: string | null;
  dataPolicyUrl: string | null;
  dataPolicyDeclaredBy: string | null;
  dataPolicyDeclaredAt: number | null;
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
  privacyMode?: string;
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
    privacyMode: string;
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
  /** Partial-extraction or safety note, when the server has one. */
  note?: string;
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
  /** Where the tool came from, so the menu can group them. */
  source: "builtin" | "mcp" | "custom";
  server?: string;
  /** Where the tool sends data, so Settings can warn before the first run. */
  egress?: { kind: "none" | "local" | "thirdParty"; destination?: string; note?: string };
}

export interface ToolsState {
  config: {
    webSearch: {
      enabled: boolean;
      provider: "tavily" | "brave" | "serper" | "searxng" | "custom";
      baseUrl?: string;
      endpoint?: string;
      maxResults: number;
    };
    fetch: { enabled: boolean };
    code: { autoApprove: boolean };
    coding: {
      enabled: boolean;
      root: string;
      allowCommands: boolean;
      autoApproveWrites: boolean;
      maxReadBytes: number;
    };
  };
  /** Resolved coding workspace, so Settings can show the real folder. */
  workspace?: {
    enabled: boolean;
    root: string;
    exists: boolean;
    allowCommands: boolean;
    autoApproveWrites: boolean;
  };
  hasSearchApiKey: boolean;
  maskedSearchApiKey: string;
  available: string[];
  specs: ToolSpecDto[];
}

export interface McpServerDto {
  id: string;
  name: string;
  url: string;
  transport: "http" | "sse";
  enabled: boolean;
  requiresApproval: boolean;
  headers: Array<{ name: string; masked: string; secret: boolean }>;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  lastSyncedAt: number | null;
  error: string | null;
  serverInfo: string | null;
}

export interface McpToolDto {
  name: string;
  exposed: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResourceDto {
  uri: string;
  name: string;
  description: string;
  mimeType: string | null;
}

export interface McpPromptDto {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
}

export interface McpCacheDto {
  fetchedAt: number;
  tools: McpToolDto[];
  resources: McpResourceDto[];
  prompts: McpPromptDto[];
  serverInfo: string | null;
  error: string | null;
}

export interface CustomToolDto {
  id: string;
  exposed: string;
  label: string;
  description: string;
  method: "GET" | "POST";
  url: string;
  headers: Array<{ name: string; masked: string; secret: boolean }>;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  enabled: boolean;
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
/** A saved or built-in preset as offered by the defaults endpoint. */
export interface PresetOptionDto extends StoredPreset {
  builtin: boolean;
}

/** The model + "AI performance" preset a brand-new chat starts with. */
export interface ChatDefaultsDto {
  presetId: string;
  controls: {
    temperature: number;
    topP: number;
    maxTokens: number;
    thinkingBudget: number | null;
  };
  modelId: string | null;
}


export interface SkillDto {
  id: string;
  skillKey: string;
  version: number;
  name: string;
  description: string;
  taskTypes: string[];
  instructions: string;
  requiredTools: string[];
  source: "builtin" | "user" | "imported" | "verified";
  provenance: { url?: string | null; retrievedAt?: number | null; contentHash?: string | null };
  trustStatus: "trusted" | "untrusted" | "reviewed";
  integrityHash: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  assignedProjects: number;
}

export interface SkillVersionDto {
  id: string;
  skillKey: string;
  version: number;
  name: string;
  description: string;
  taskTypes: string[];
  instructions: string;
  requiredTools: string[];
  source: string;
  provenance: { url?: string | null; retrievedAt?: number | null; contentHash?: string | null };
  trustStatus: string;
  integrityHash: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
/* ------------------------------------------------------------------ */
/* Privacy layer (Section 3)                                           */
/* ------------------------------------------------------------------ */

export interface PrivacyPolicyDto {
  training: string;
  retention: string;
  region: string | null;
  url: string | null;
  declaredBy: string | null;
  declaredAt: number | null;
}

export interface PrivacyProviderDto {
  id: string;
  name: string;
  apiFormat: string;
  host: string;
  local: boolean;
  policy: PrivacyPolicyDto;
  label: string;
}

export interface PrivacyModeInfoDto {
  label: string;
  summary: string;
  detail: string;
}

export interface PrivacySettingsDto {
  defaultMode: string;
  minimumProviderPolicy: string;
  retentionDays: number | null;
  blockRemoteImages: boolean;
  requireSendPreview: boolean;
  customRedactionTerms: string[];
  customRedactionPatterns: string[];
}

export interface StorageSummaryDto {
  databasePath: string;
  chats: number;
  messages: number;
  attachments: number;
  artifacts: number;
  memories: number;
  projects: number;
  projectFiles: number;
  usageEvents: number;
  egressEvents: number;
  providers: number;
}

export interface EgressEventDto {
  id: string;
  chatId: string | null;
  providerId: string | null;
  kind: string;
  destination: string;
  label: string | null;
  mode: string;
  bytesOut: number;
  redactionCount: number;
  payloadHash: string | null;
  status: string;
  createdAt: number;
}

export interface DestinationSummaryDto {
  destination: string;
  kinds: string[];
  count: number;
  lastAt: number;
}

export interface PrivacyStateDto {
  settings: PrivacySettingsDto;
  summary: StorageSummaryDto;
  destinations: DestinationSummaryDto[];
  providers: PrivacyProviderDto[];
  modes: Record<string, PrivacyModeInfoDto>;
}

export interface RedactionSummaryItemDto {
  placeholder: string;
  kind: string;
  credential: boolean;
  preview: string;
  count: number;
}

export interface RedactionSummaryDto {
  applied: boolean;
  total: number;
  items: RedactionSummaryItemDto[];
}

export interface PolicyGateDto {
  allowed: boolean;
  reasons: string[];
  options: Array<{ kind: string; label: string; description: string }>;
  providerLabel: string;
  minimum: string;
}

export interface SendPreviewDto {
  mode: string;
  destination: { kind: string; label: string; host: string };
  model: string;
  policy: PrivacyPolicyDto;
  gate: PolicyGateDto;
  messages: { count: number; roles: Record<string, number> };
  attachments: Array<{ name: string; kind: string; size: number }>;
  memory: { included: boolean; items: number };
  tools: Array<{ name: string; label: string; egress: { kind: string; destination?: string; note?: string } }>;
  redactions: RedactionSummaryDto;
  credentials: RedactionSummaryItemDto[];
  systemPromptChars: number;
  approxInputTokens: number;
  payloadHash: string;
  notes: string[];
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
    privacyMode?: string;
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

  uploadFile: (file: File, onProgress?: (percent: number) => void) => {
    const form = new FormData();
    form.append("file", file);
    return upload<{ file: UploadedFile }>("/api/files", form, onProgress);
  },
  getFileUrl: (id: string) => `/api/files/${id}`,

  listPresets: () => request<{ presets: StoredPreset[] }>("/api/presets"),
  savePresets: (presets: StoredPreset[]) =>
    request<{ presets: StoredPreset[] }>("/api/presets", { method: "PUT", body: JSON.stringify({ presets }) }),

  /* --- Workspace chat defaults (model + AI performance) ------------------ */
  getDefaults: () =>
    request<{ defaults: ChatDefaultsDto; presets: PresetOptionDto[]; models: ModelOptionDto[] }>(
      "/api/defaults"
    ),
  saveDefaults: (patch: { presetId?: string; modelId?: string | null }) =>
    request<{ defaults: ChatDefaultsDto; presets: PresetOptionDto[]; models: ModelOptionDto[] }>(
      "/api/defaults",
      { method: "PUT", body: JSON.stringify(patch) }
    ),

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

  /* --- MCP client, custom tools, Deep Research (M9) ---------------------- */
  listMcpServers: () => request<{ servers: McpServerDto[] }>("/api/mcp"),
  createMcpServer: (input: {
    name: string;
    url: string;
    transport?: "http" | "sse";
    enabled?: boolean;
    requiresApproval?: boolean;
    headers?: Array<{ name: string; value: string | null; secret?: boolean }>;
  }) =>
    request<{ servers: McpServerDto[]; serverId: string; synced: boolean; syncError: string | null }>("/api/mcp", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateMcpServer: (id: string, patch: Record<string, unknown>) =>
    request<{ server: McpServerDto; servers: McpServerDto[] }>(`/api/mcp/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteMcpServer: (id: string) => request<{ servers: McpServerDto[] }>(`/api/mcp/${id}`, { method: "DELETE" }),
  getMcpServer: (id: string) => request<{ server: McpServerDto; cache: McpCacheDto | null }>(`/api/mcp/${id}`),
  refreshMcpServer: (id: string) =>
    request<{ servers: McpServerDto[]; cache: { toolCount: number; resourceCount: number; promptCount: number } }>(
      `/api/mcp/${id}`,
      { method: "POST", body: JSON.stringify({ action: "refresh" }) }
    ),
  testMcpServer: (id: string, input: { url: string; transport: "http" | "sse" }) =>
    request<{ test: { toolCount: number; resourceCount: number; promptCount: number; serverInfo: string | null } }>(
      `/api/mcp/${id}`,
      { method: "POST", body: JSON.stringify({ action: "test", ...input }) }
    ),
  readMcpResource: (id: string, uri: string) =>
    request<{ text: string }>(`/api/mcp/${id}`, { method: "POST", body: JSON.stringify({ action: "resource", uri }) }),
  getMcpPrompt: (id: string, name: string, args: Record<string, string> = {}) =>
    request<{ text: string }>(`/api/mcp/${id}`, {
      method: "POST",
      body: JSON.stringify({ action: "prompt", name, args }),
    }),

  listCustomTools: () => request<{ tools: CustomToolDto[] }>("/api/custom-tools"),
  createCustomTool: (input: {
    label: string;
    description?: string;
    method: "GET" | "POST";
    url: string;
    parameters?: Record<string, unknown>;
    requiresApproval?: boolean;
    enabled?: boolean;
    headers?: Array<{ name: string; value: string | null; secret?: boolean }>;
  }) =>
    request<{ tool: CustomToolDto; tools: CustomToolDto[] }>("/api/custom-tools", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCustomTool: (id: string, patch: Record<string, unknown>) =>
    request<{ tool: CustomToolDto; tools: CustomToolDto[] }>(`/api/custom-tools/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCustomTool: (id: string) => request<{ tools: CustomToolDto[] }>(`/api/custom-tools/${id}`, { method: "DELETE" }),
  testCustomTool: (id: string) =>
    request<{ test: { status: number; preview: string } }>(`/api/custom-tools/${id}`, { method: "POST" }),
  /* --- Privacy layer (Section 3) ----------------------------------------- */
  getPrivacy: () => request<PrivacyStateDto>("/api/privacy"),
  updatePrivacy: (patch: Partial<PrivacySettingsDto>) =>
    request<{ settings: PrivacySettingsDto }>("/api/privacy", { method: "PATCH", body: JSON.stringify(patch) }),
  privacyAction: (input: { action: "purge" | "delete-all" | "clear-egress"; includeProviders?: boolean; retentionDays?: number }) =>
    request<{ ok: true; result?: unknown; cleared?: number }>("/api/privacy", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getEgress: (options: { chatId?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.chatId) params.set("chatId", options.chatId);
    if (options.limit) params.set("limit", String(options.limit));
    const query = params.toString();
    return request<{ events: EgressEventDto[]; destinations: DestinationSummaryDto[] }>(
      `/api/privacy/egress${query ? `?${query}` : ""}`
    );
  },
  clearEgress: (chatId?: string) =>
    request<{ ok: true; cleared: number }>(
      `/api/privacy/egress${chatId ? `?chatId=${encodeURIComponent(chatId)}` : ""}`,
      { method: "DELETE" }
    ),
  sendPreview: (input: unknown) =>
    request<{ preview: SendPreviewDto }>("/api/privacy/preview", { method: "POST", body: JSON.stringify(input) }),

  /* --- Skills (M9) --------------------------------------------------------- */
  listSkills: () => request<{ skills: SkillDto[] }>("/api/skills"),
  createSkill: (input: {
    name: string;
    description?: string;
    taskTypes?: string[];
    instructions?: string;
    requiredTools?: string[];
  }) => request<{ skill: SkillDto }>("/api/skills", { method: "POST", body: JSON.stringify(input) }),
  getSkill: (id: string) =>
    request<{ skill: SkillDto; versions: SkillVersionDto[] }>(`/api/skills/${id}`),
  updateSkill: (id: string, patch: Record<string, unknown>) =>
    request<{ skill: SkillDto; versionBumped: boolean }>(`/api/skills/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteSkill: (id: string) => request<{ ok: true }>(`/api/skills/${id}`, { method: "DELETE" }),
  importSkill: (payload: unknown) =>
    request<{ skill: SkillDto; trustStatus: string }>("/api/skills/import", {
      method: "POST",
      body: JSON.stringify({ payload }),
    }),
  exportSkill: (id: string) =>
    request<{ skill: unknown; filename: string }>(`/api/skills/${id}`, { method: "POST" }),
  getProjectSkills: (projectId: string) =>
    request<{ skills: SkillDto[] }>(`/api/projects/${projectId}/skills`),
  assignProjectSkill: (projectId: string, skillId: string) =>
    request<{ skills: SkillDto[]; assigned: boolean }>(`/api/projects/${projectId}/skills`, {
      method: "POST",
      body: JSON.stringify({ skillId }),
    }),
  unassignProjectSkill: (projectId: string, skillId: string) =>
    request<{ skills: SkillDto[] }>(`/api/projects/${projectId}/skills?skillId=${encodeURIComponent(skillId)}`, {
      method: "DELETE",
    }),
};