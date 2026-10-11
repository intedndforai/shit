import { randomUUID } from "node:crypto";
import { type AnySQLiteColumn, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Conduit SQLite schema (Drizzle ORM).
 *
 * Milestone discipline: the full application data model is defined up front so
 * migrations stay stable as features land. Every table below is part of the
 * shipped model; feature code arrives in later milestones.
 */

const uuid = () => randomUUID();
const now = () => new Date();

/* ------------------------------------------------------------------ */
/* Identity (single-user mode by default; multi-user lands in M11)     */
/* ------------------------------------------------------------------ */

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(uuid),
  name: text("name").notNull().default("Local user"),
  role: text("role").notNull().default("user"), // user | admin
  preferences: text("preferences", { mode: "json" })
    .$type<{
      instructions?: string;
      responseStyleId?: string | null;
      profile?: string;
    }>()
    .notNull()
    .default({}),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

/* ------------------------------------------------------------------ */
/* Providers + models (M2 wires the adapters; schema is ready now)     */
/* ------------------------------------------------------------------ */

export const providerFormats = [
  "openai-completions",
  "openai-responses",
  "anthropic",
  "gemini",
] as const;

export type ProviderFormat = (typeof providerFormats)[number];

export const providers = sqliteTable(
  "providers",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    // AES-256-GCM encrypted at rest; IV stored alongside. Never logged.
    apiKeyEncrypted: text("api_key_encrypted"),
    apiKeyIv: text("api_key_iv"),
    apiFormat: text("api_format", { enum: [...providerFormats] })
      .notNull()
      .default("openai-completions"),
    customHeaders: text("custom_headers", { mode: "json" })
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    organizationId: text("organization_id"),
    projectId: text("project_id"),
    // Model-role flags: which model fulfills each special purpose.
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    isTitleModel: integer("is_title_model", { mode: "boolean" }).notNull().default(false),
    isSummarizationModel: integer("is_summarization_model", { mode: "boolean" }).notNull().default(false),
    isEmbeddingsModel: integer("is_embeddings_model", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  },
  (table) => [index("providers_default_idx").on(table.isDefault)]
);

export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;

export const modelCapabilityFlags = [
  "vision",
  "toolCalling",
  "reasoning",
  "jsonMode",
  "promptCaching",
  "imageGeneration",
  "audioInput",
] as const;

export type ModelCapabilities = Partial<Record<(typeof modelCapabilityFlags)[number], boolean>>;

export const models = sqliteTable(
  "models",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(), // id returned by GET {baseUrl}/models
    displayName: text("display_name"),
    contextWindow: integer("context_window").notNull().default(128000),
    maxOutputTokens: integer("max_output_tokens").notNull().default(8192),
    capabilities: text("capabilities", { mode: "json" })
      .$type<ModelCapabilities>()
      .notNull()
      .default({}),
    pricePerMillionInput: real("price_per_million_input").notNull().default(0),
    pricePerMillionOutput: real("price_per_million_output").notNull().default(0),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    isFallback: integer("is_fallback", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  },
  (table) => [
    index("models_provider_idx").on(table.providerId),
    index("models_default_idx").on(table.isDefault),
  ]
);

export type Model = typeof models.$inferSelect;

/* ------------------------------------------------------------------ */
/* Chats + message tree                                                */
/* ------------------------------------------------------------------ */

export const chatRoles = ["system", "user", "assistant", "tool"] as const;
export type ChatRole = (typeof chatRoles)[number];

export const chats = sqliteTable(
  "chats",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    title: text("title"),
    // Where the current title came from: "auto" (placeholder, still upgradable),
    // "model" (generated by the title model), or "user" (renamed by hand).
    titleSource: text("title_source").notNull().default("auto"),
    systemPrompt: text("system_prompt"),
    providerId: text("provider_id").references(() => providers.id, { onDelete: "set null" }),
    modelId: text("model_id").references(() => models.id, { onDelete: "set null" }),
    // Message-tree pointer: the leaf that defines the currently visible path.
    activeLeafId: text("active_leaf_id"),
    temperature: real("temperature").notNull().default(0.7),
    topP: real("top_p").notNull().default(1),
    maxTokens: integer("max_tokens").notNull().default(8192),
    thinkingBudget: integer("thinking_budget"),
    styleId: text("style_id").references(() => responseStyles.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    incognito: integer("incognito", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  },
  (table) => [
    index("chats_updated_idx").on(table.updatedAt),
    index("chats_pinned_idx").on(table.pinned, table.archived),
    index("chats_project_idx").on(table.projectId),
  ]
);

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;

/**
 * Content parts mirror the normalized provider-agnostic message body:
 * text, image, document, tool_use, tool_result, thinking. Adapters
 * translate these to and from each vendor format.
 */
export type ContentPart =
  | { kind: "text"; text: string }
  | { kind: "image"; dataUrl?: string; url?: string; alt?: string }
  | { kind: "document"; name: string; mime: string; url?: string; text?: string }
  | {
      kind: "tool_use";
      id: string;
      name: string;
      input: unknown;
      status?: "pending" | "running" | "success" | "error";
      error?: string;
    }
  | { kind: "tool_result"; id: string; output: string; isError?: boolean }
  | { kind: "thinking"; text: string; durationMs?: number };

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    // Branched history: parent_id + branch_index form a tree; the active
    // leaf is derived per chat (deepest updatedAt path).
    parentId: text("parent_id").references((): AnySQLiteColumn => messages.id, { onDelete: "set null" }),
    branchIndex: integer("branch_index").notNull().default(0),
    role: text("role", { enum: [...chatRoles] }).notNull(),
    content: text("content", { mode: "json" }).$type<ContentPart[]>().notNull().default([]),
    modelId: text("model_id").references(() => models.id, { onDelete: "set null" }),
    tokenUsage: text("token_usage", { mode: "json" })
      .$type<{ promptTokens?: number; completionTokens?: number; totalTokens?: number }>()
      .notNull()
      .default({}),
    cost: real("cost").notNull().default(0),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  },
  (table) => [
    index("messages_chat_idx").on(table.chatId, table.createdAt),
    index("messages_parent_idx").on(table.parentId),
  ]
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

/* ------------------------------------------------------------------ */
/* Attachments (M4): bytes on disk, metadata + extracted text here     */
/* ------------------------------------------------------------------ */

export const attachmentKinds = ["text", "image", "document", "spreadsheet", "pdf", "other"] as const;
export type AttachmentKind = (typeof attachmentKinds)[number];

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    chatId: text("chat_id").references(() => chats.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    kind: text("kind", { enum: [...attachmentKinds] }).notNull(),
    storagePath: text("storage_path").notNull(),
    text: text("text"),
    truncated: integer("truncated", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  },
  (table) => [index("attachments_chat_idx").on(table.chatId), index("attachments_message_idx").on(table.messageId)]
);

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;

/* ------------------------------------------------------------------ */
/* Artifacts (M5)                                                      */
/* ------------------------------------------------------------------ */

export const artifactTypes = ["html", "react", "svg", "mermaid", "markdown", "code"] as const;
export type ArtifactType = (typeof artifactTypes)[number];

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    identifier: text("identifier").notNull(), // model-supplied artifact id; new versions share it
    type: text("type", { enum: [...artifactTypes] }).notNull(),
    title: text("title"),
    content: text("content").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  },
  (table) => [index("artifacts_chat_idx").on(table.chatId, table.identifier)]
);

/* ------------------------------------------------------------------ */
/* Projects + RAG (M8)                                                 */
/* ------------------------------------------------------------------ */

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey().$defaultFn(uuid),
  name: text("name").notNull(),
  description: text("description"),
  instructions: text("instructions"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const projectFiles = sqliteTable("project_files", {
  id: text("id").primaryKey().$defaultFn(uuid),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mimeType: text("mime_type"),
  size: integer("size").notNull().default(0),
  storagePath: text("storage_path"), // server-side file location
  status: text("status").notNull().default("pending"), // pending | indexing | indexed | failed
  chunkCount: integer("chunk_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

/* ------------------------------------------------------------------ */
/* Memory (M8)                                                         */
/* ------------------------------------------------------------------ */

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey().$defaultFn(uuid),
  content: text("content").notNull(),
  sourceChatId: text("source_chat_id").references(() => chats.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

/* ------------------------------------------------------------------ */
/* Response styles + saved prompts (M8)                                */
/* ------------------------------------------------------------------ */

export const responseStyles = sqliteTable("response_styles", {
  id: text("id").primaryKey().$defaultFn(uuid),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  instructions: text("instructions").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const savedPrompts = sqliteTable("saved_prompts", {
  id: text("id").primaryKey().$defaultFn(uuid),
  name: text("name").notNull(),
  command: text("command").notNull().unique(), // e.g. "summarize"
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

/* ------------------------------------------------------------------ */
/* Sharing + usage (M10/M11)                                           */
/* ------------------------------------------------------------------ */

export const shareLinks = sqliteTable(
  "share_links",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  },
  (table) => [index("share_links_chat_idx").on(table.chatId)]
);

export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    providerId: text("provider_id").references(() => providers.id, { onDelete: "set null" }),
    modelId: text("model_id").references(() => models.id, { onDelete: "set null" }),
    chatId: text("chat_id").references(() => chats.id, { onDelete: "set null" }),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    cost: real("cost").notNull().default(0),
    requestAt: integer("request_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  },
  (table) => [
    index("usage_model_idx").on(table.modelId),
    index("usage_request_idx").on(table.requestAt),
  ]
);

/* ------------------------------------------------------------------ */
/* App settings (key/value)                                            */
/* ------------------------------------------------------------------ */

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});