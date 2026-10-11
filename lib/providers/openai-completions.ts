/**
 * OpenAI-compatible Chat Completions adapter.
 *
 * Works with the OpenAI API, Azure-style gateways, Ollama, LM Studio, vLLM,
 * OpenRouter, Groq, Together, and anything else that speaks
 * `POST {baseUrl}/chat/completions` with SSE streaming.
 */

import type { ContentPart } from "@/lib/db/schema";
import { openStream } from "./http";
import { readSse, safeJsonParse } from "./sse";
import {
  joinUrl,
  ProviderError,
  type ModelInfo,
  type ProviderAdapter,
  type ProviderConnection,
  type StreamEvent,
  type StreamRequest,
} from "./types";

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  error?: { message?: string };
}

interface ModelsResponse {
  data?: Array<{ id?: string; name?: string; context_length?: number }>;
  models?: Array<{ id?: string; name?: string; context_length?: number }>;
}

function buildHeaders(connection: ProviderConnection): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    ...(connection.headers ?? {}),
  };
  if (connection.apiKey) {
    headers.authorization = `Bearer ${connection.apiKey}`;
  }
  if (connection.organizationId) headers["openai-organization"] = connection.organizationId;
  if (connection.projectId) headers["openai-project"] = connection.projectId;
  return headers;
}

function toTextOrParts(parts: ContentPart[]) {
  const hasImage = parts.some((part) => part.kind === "image");
  if (!hasImage) {
    return parts
      .map((part) => {
        if (part.kind === "text") return part.text;
        if (part.kind === "document") return part.text ?? `[document: ${part.name}]`;
        if (part.kind === "tool_result") return part.output;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  return parts
    .map((part) => {
      if (part.kind === "text") return { type: "text", text: part.text };
      if (part.kind === "image") {
        const url = part.dataUrl ?? part.url;
        return url ? { type: "image_url", image_url: { url } } : null;
      }
      if (part.kind === "document" && part.text) {
        return { type: "text", text: `--- ${part.name} ---\n${part.text}` };
      }
      return null;
    })
    .filter(Boolean);
}

function toApiMessages(request: StreamRequest) {
  const messages: Array<Record<string, unknown>> = [];

  if (request.system) {
    messages.push({ role: "system", content: request.system });
  }

  for (const message of request.messages) {
    if (message.role === "system") {
      messages.push({ role: "system", content: toTextOrParts(message.content) });
      continue;
    }

    if (message.role === "assistant") {
      const text = message.content
        .filter((part) => part.kind === "text")
        .map((part) => (part.kind === "text" ? part.text : ""))
        .join("");
      const toolCalls = message.content
        .filter((part) => part.kind === "tool_use")
        .map((part) =>
          part.kind === "tool_use"
            ? {
                id: part.id,
                type: "function",
                function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) },
              }
            : null
        )
        .filter(Boolean);

      messages.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    if (message.role === "tool") {
      for (const part of message.content) {
        if (part.kind === "tool_result") {
          messages.push({ role: "tool", tool_call_id: part.id, content: part.output });
        }
      }
      continue;
    }

    messages.push({ role: "user", content: toTextOrParts(message.content) });
  }

  return messages;
}

function toApiTools(request: StreamRequest) {
  if (!request.tools?.length) return undefined;
  return request.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export const openAiCompatibleAdapter: ProviderAdapter = {
  async *stream(request: StreamRequest): AsyncGenerator<StreamEvent, void, unknown> {
    const url = joinUrl(request.baseUrl, "chat/completions");
    const tools = toApiTools(request);

    const body: Record<string, unknown> = {
      model: request.model,
      messages: toApiMessages(request),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (typeof request.temperature === "number") body.temperature = request.temperature;
    if (typeof request.topP === "number") body.top_p = request.topP;
    if (typeof request.maxTokens === "number") body.max_tokens = request.maxTokens;
    if (tools) body.tools = tools;

    let response: Response;
    try {
      response = await openStream(url, { method: "POST", headers: buildHeaders(request), body: JSON.stringify(body) }, { signal: request.signal });
    } catch (error) {
      // Some servers reject `stream_options`; retry once without it.
      if (error instanceof ProviderError && error.status === 400) {
        delete body.stream_options;
        response = await openStream(url, { method: "POST", headers: buildHeaders(request), body: JSON.stringify(body) }, { signal: request.signal, retries: 0 });
      } else {
        throw error;
      }
    }

    const toolCalls = new Map<number, { id: string; name: string; args: string }>();
    let sawUsage = false;

    for await (const payload of readSse(response)) {
      const chunk = safeJsonParse<ChatCompletionChunk>(payload);
      if (!chunk) continue;

      if (chunk.error?.message) {
        yield { type: "error", message: chunk.error.message };
        return;
      }

      const choice = chunk.choices?.[0];
      const delta = choice?.delta;

      if (delta?.reasoning_content) yield { type: "reasoning_delta", text: delta.reasoning_content };
      else if (delta?.reasoning) yield { type: "reasoning_delta", text: delta.reasoning };

      if (delta?.content) yield { type: "text_delta", text: delta.content };

      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const existing = toolCalls.get(index);

        if (!existing) {
          const id = call.id ?? `tool_${index}`;
          const name = call.function?.name ?? "";
          toolCalls.set(index, { id, name, args: call.function?.arguments ?? "" });
          yield { type: "tool_call_start", id, name };
        } else {
          if (call.id) existing.id = call.id;
          if (call.function?.name) existing.name = call.function.name;
          if (call.function?.arguments) {
            existing.args += call.function.arguments;
            yield { type: "tool_call_delta", id: existing.id, argumentsDelta: call.function.arguments };
          }
        }
      }

      if (chunk.usage) {
        sawUsage = true;
        yield {
          type: "usage",
          usage: {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          },
        };
      }
    }

    for (const call of toolCalls.values()) {
      let input: unknown = {};
      try {
        input = call.args ? JSON.parse(call.args) : {};
      } catch {
        input = { _raw: call.args };
      }
      yield { type: "tool_call_end", id: call.id, input };
    }

    if (!sawUsage) {
      yield { type: "usage", usage: {} };
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

    const payload = (await response.json()) as ModelsResponse;
    const entries = payload.data ?? payload.models ?? [];
    return entries
      .filter((entry) => Boolean(entry.id ?? entry.name))
      .map((entry) => ({
        id: (entry.id ?? entry.name) as string,
        displayName: entry.name ?? entry.id,
        contextWindow: entry.context_length,
      }));
  },
};