import { ProviderError } from "./types";

export interface OpenStreamOptions {
  retries?: number;
  signal?: AbortSignal;
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/**
 * Open a streaming HTTP request with exponential backoff on 429/5xx.
 * Retries only happen before any bytes are consumed, so a retry can never
 * duplicate tokens that the user has already seen.
 */
export async function openStream(
  url: string,
  init: RequestInit,
  { retries = 2, signal }: OpenStreamOptions = {}
): Promise<Response> {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= retries) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    let response: Response;
    try {
      response = await fetch(url, { ...init, signal });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      lastError = error;
      if (attempt === retries) {
        throw new ProviderError(
          `Could not reach the provider at ${url}. Check the Base URL, your network, and whether the server is running.`,
          { retryable: true }
        );
      }
      await delay(backoffMs(attempt));
      attempt += 1;
      continue;
    }

    if (response.ok) return response;

    const detail = await readErrorDetail(response);

    if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) {
      throw new ProviderError(detail.message, {
        status: response.status,
        retryable: RETRYABLE_STATUS.has(response.status),
      });
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
    await delay(wait);
    attempt += 1;
  }

  throw new ProviderError(
    lastError instanceof Error ? lastError.message : "Provider request failed.",
    { retryable: true }
  );
}

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Turn a failed response into a message a human can act on. */
async function readErrorDetail(response: Response): Promise<{ message: string }> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }

  const parsed = body ? tryParse(body) : null;
  const apiMessage =
    parsed?.error?.message ?? parsed?.message ?? parsed?.error?.type ?? (body.slice(0, 300) || undefined);

  switch (response.status) {
    case 401:
    case 403:
      return {
        message: `Authentication failed (${response.status}). Check the API key for this provider.${apiMessage ? ` Provider said: ${apiMessage}` : ""}`,
      };
    case 404:
      return {
        message: `Endpoint not found (404). The Base URL is probably wrong — it should point at the API root, for example https://api.openai.com/v1.${apiMessage ? ` Provider said: ${apiMessage}` : ""}`,
      };
    case 429:
      return {
        message: `Rate limited (429). Conduit will retry automatically.${apiMessage ? ` Provider said: ${apiMessage}` : ""}`,
      };
    default:
      return {
        message: apiMessage
          ? `Provider error (${response.status}): ${apiMessage}`
          : `Provider error (${response.status}).`,
      };
  }
}

function tryParse(body: string): { error?: { message?: string; type?: string }; message?: string } | null {
  try {
    return JSON.parse(body) as { error?: { message?: string; type?: string }; message?: string };
  } catch {
    return null;
  }
}