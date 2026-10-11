/**
 * Provider-agnostic contracts.
 *
 * Every vendor format is translated into these normalized messages and stream
 * events, so the chat pipeline (and the UI) never knows which vendor it talks
 * to. Adding a vendor means adding one adapter file.
 */

import type { ContentPart } from "@/lib/db/schema";

export type ProviderFormat = "openai-completions" | "openai-responses" | "anthropic" | "gemini";

export const PROVIDER_FORMAT_LABELS: Record<ProviderFormat, string> = {
  "openai-completions": "OpenAI-compatible (Chat Completions)",
  "openai-responses": "OpenAI Responses API",
  anthropic: "Anthropic Messages API",
  gemini: "Google Gemini",
};

export interface InternalMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ContentPart[];
}

export interface ToolDefinition {
  name: string;
  description?: string;
  /** JSON Schema for the tool input. */
  parameters: Record<string, unknown>;
}

export interface ProviderConnection {
  baseUrl: string;
  apiKey?: string | null;
  apiFormat: ProviderFormat;
  headers?: Record<string, string>;
  organizationId?: string | null;
  projectId?: string | null;
}

export interface StreamRequest extends ProviderConnection {
  model: string;
  messages: InternalMessage[];
  system?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** Extended-thinking budget in tokens, when the model supports it. */
  thinkingBudget?: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface UsageInfo {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; argumentsDelta: string }
  | { type: "tool_call_end"; id: string; input: unknown }
  | { type: "usage"; usage: UsageInfo }
  | { type: "error"; message: string; status?: number; retryable?: boolean }
  | { type: "done" };

export interface ModelInfo {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface ProviderAdapter {
  /** Stream a completion as normalized events. */
  stream(request: StreamRequest): AsyncGenerator<StreamEvent, void, unknown>;
  /** Fetch the model list from the provider. */
  listModels(connection: ProviderConnection): Promise<ModelInfo[]>;
}

/** Error type that carries the HTTP status so the UI can explain failures. */
export class ProviderError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function contentToText(content: ContentPart[]): string {
  return content
    .map((part) => {
      switch (part.kind) {
        case "text":
          return part.text;
        case "thinking":
          return "";
        case "tool_use":
          return `[tool ${part.name}]`;
        case "tool_result":
          return part.output;
        case "document":
          return part.text ? `--- ${part.name} ---\n${part.text}` : `[document ${part.name}]`;
        case "image":
          return "[image]";
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

export function textPart(text: string): ContentPart {
  return { kind: "text", text };
}