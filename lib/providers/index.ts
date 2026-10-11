import { anthropicAdapter } from "./anthropic";
import { openAiCompatibleAdapter } from "./openai-completions";
import { ProviderError, type ProviderAdapter, type ProviderFormat } from "./types";

/**
 * Adapter registry. Two formats ship in Milestone 2; the Responses API and the
 * Gemini format plug in here as additional files without touching callers.
 */
export function getAdapter(format: ProviderFormat): ProviderAdapter {
  switch (format) {
    case "openai-completions":
      return openAiCompatibleAdapter;
    case "anthropic":
      return anthropicAdapter;
    case "openai-responses":
      throw new ProviderError(
        "The OpenAI Responses API adapter is not available yet. Use the OpenAI-compatible Chat Completions format for now.",
        { status: 501 }
      );
    case "gemini":
      throw new ProviderError(
        "The Google Gemini adapter is not available yet. Use the OpenAI-compatible Chat Completions format for now.",
        { status: 501 }
      );
    default: {
      const exhaustive: never = format;
      throw new ProviderError(`Unsupported provider format: ${String(exhaustive)}`, { status: 400 });
    }
  }
}

export const SUPPORTED_FORMATS: ProviderFormat[] = ["openai-completions", "anthropic"];
export const PLANNED_FORMATS: ProviderFormat[] = ["openai-responses", "gemini"];

export * from "./types";