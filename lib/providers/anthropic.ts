/**
 * Anthropic Messages adapter (`POST {baseUrl}/messages`).
 *
 * Handles text, images, tool use, tool results, extended-thinking blocks, and
 * the `thinking_budget` slider, all translated into normalized stream events.
 */

import type { ContentPart } from "@/lib/db/schema";
import { openStream } from "./http";
import { readSse, safeJsonParse } from "./sse";
import {
  joinUrl,
  type InternalMessage,
  type ModelInfo,
  type ProviderAdapter,
  type ProviderConnection,
  type StreamEvent,
  type StreamRequest,
} from "./types";

const ANTHROPIC_VERSION = "2023-06-01";

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string | null;
  };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; type?: string };
}

function buildHeaders(connection: ProviderConnection): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    "anthropic-version": ANTHROPIC_VERSION,
    ...(connection.headers ?? {}),
  };
  if (connection.apiKey) headers["x-api-key"] = connection.apiKey;
  return headers;
}

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function toContentBlocks(parts: ContentPart[]): AnthropicBlock[] {
  const blocks: AnthropicBlock[] = [];

  for (const part of parts) {
    switch (part.kind) {
      case "text":
        if (part.text.trim()) blocks.push({ type: "text", text: part.text });
        break;
      case "image": {
        const source = part.dataUrl ? parseDataUrl(part.dataUrl) : null;
        if (source) {
          blocks.push({ type: "image", source: { type: "base64", media_type: source.mediaType, data: source.data } });
        } else if (part.url) {
          blocks.push({ type: "image", source: { type: "url", url: part.url } });
        }
        break;
      }
      case "document":
        if (part.text) blocks.push({ type: "text", text: `--- ${part.name} ---\n${part.text}` });
        break;
      case "tool_use":
        blocks.push({ type: "tool_use", id: part.id, name: part.name, input: part.input ?? {} });
        break;
      case "tool_result":
        blocks.push({
          type: "tool_result",
          tool_use_id: part.id,
          content: part.output,
          ...(part.isError ? { is_error: true } : {}),
        });
        break;
      default:
        break;
    }
  }

  return blocks;
}

function toApiMessages(messages: InternalMessage[]) {
  const result: Array<{ role: "user" | "assistant"; content: AnthropicBlock[] }> = [];

  for (const message of messages) {
    if (message.role === "system") continue;
    const role = message.role === "assistant" ? "assistant" : "user";
    const content = toContentBlocks(message.content);
    if (!content.length) continue;

    const previous = result[result.length - 1];
    // Anthropic requires alternating roles; merge consecutive same-role turns.
    if (previous && previous.role === role) {
      previous.content.push(...content);
    } else {
      result.push({ role, content });
    }
  }

  return result;
}

export const anthropicAdapter: ProviderAdapter = {
  async *stream(request: StreamRequest): AsyncGenerator<StreamEvent, void, unknown> {
    const url = joinUrl(request.baseUrl, "messages");

    const body: Record<string, unknown> = {
      model: request.model,
      messages: toApiMessages(request.messages),
      max_tokens: request.maxTokens ?? 4096,
      stream: true,
    };
    if (request.system) body.system = request.system;
    if (typeof request.temperature === "number") body.temperature = request.temperature;
    if (typeof request.topP === "number") body.top_p = request.topP;
    if (request.thinkingBudget && request.thinkingBudget > 0) {
      body.thinking = { type: "enabled", budget_tokens: request.thinkingBudget };
    }
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    const response = await openStream(
      url,
      { method: "POST", headers: buildHeaders(request), body: JSON.stringify(body) },
      { signal: request.signal }
    );

    // Tool inputs arrive as partial JSON across deltas; collect per index.
    const toolBuffers = new Map<number, { id: string; name: string; json: string }>();

    for await (const payload of readSse(response)) {
      const event = safeJsonParse<AnthropicStreamEvent>(payload);
      if (!event) continue;

      if (event.type === "error") {
        yield { type: "error", message: event.error?.message ?? "Anthropic returned an error." };
        return;
      }

      if (event.type === "message_start" && event.message?.usage) {
        yield {
          type: "usage",
          usage: { promptTokens: event.message.usage.input_tokens ?? 0 },
        };
        continue;
      }

      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        const index = event.index ?? 0;
        const id = event.content_block.id ?? `tool_${index}`;
        const name = event.content_block.name ?? "";
        toolBuffers.set(index, { id, name, json: "" });
        yield { type: "tool_call_start", id, name };
        continue;
      }

      if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta?.type === "text_delta" && delta.text) {
          yield { type: "text_delta", text: delta.text };
        } else if (delta?.type === "thinking_delta" && delta.thinking) {
          yield { type: "reasoning_delta", text: delta.thinking };
        } else if (delta?.type === "input_json_delta" && delta.partial_json) {
          const index = event.index ?? 0;
          const buffer = toolBuffers.get(index);
          if (buffer) {
            buffer.json += delta.partial_json;
            yield { type: "tool_call_delta", id: buffer.id, argumentsDelta: delta.partial_json };
          }
        }
        continue;
      }

      if (event.type === "content_block_stop") {
        const index = event.index ?? 0;
        const buffer = toolBuffers.get(index);
        if (buffer) {
          let input: unknown = {};
          try {
            input = buffer.json ? JSON.parse(buffer.json) : {};
          } catch {
            input = { _raw: buffer.json };
          }
          yield { type: "tool_call_end", id: buffer.id, input };
          toolBuffers.delete(index);
        }
        continue;
      }

      if (event.type === "message_delta" && event.usage) {
        yield {
          type: "usage",
          usage: {
            completionTokens: event.usage.output_tokens,
            totalTokens: event.usage.output_tokens,
          },
        };
        continue;
      }

      if (event.type === "message_stop") {
        yield { type: "done" };
        return;
      }
    }

    yield { type: "done" };
  },

  async listModels(connection: ProviderConnection): Promise<ModelInfo[]> {
    const url = joinUrl(connection.baseUrl, "models");
    const response = await openStream(
      url,
      {
        method: "GET",
        headers: {
          ...buildHeaders(connection),
          accept: "application/json",
        },
      },
      { retries: 1 }
    );

    const payload = (await response.json()) as {
      data?: Array<{ id?: string; display_name?: string }>;
      models?: Array<{ id?: string; display_name?: string }>;
    };
    const entries = payload.data ?? payload.models ?? [];

    return entries
      .filter((entry) => Boolean(entry.id))
      .map((entry) => ({ id: entry.id as string, displayName: entry.display_name ?? entry.id }));
  },
};