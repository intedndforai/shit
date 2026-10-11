import { getSetting } from "@/lib/server/settings";
import { decryptText } from "@/lib/crypto";

/**
 * Web search through a user-supplied provider. Conduit never ships a hardcoded
 * search vendor or key — the user configures one in Settings and it is stored
 * encrypted.
 */

export const SEARCH_PROVIDERS = ["tavily", "brave", "serper", "searxng"] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

export interface ToolsConfig {
  webSearch: {
    enabled: boolean;
    provider: SearchProvider;
    /** Optional base URL for self-hosted SearXNG. */
    baseUrl?: string;
    maxResults: number;
  };
  fetch: { enabled: boolean };
  /** Browser-side code runners (Python/JavaScript) ask before running by default. */
  code: { autoApprove: boolean };
}

export interface ToolsSecrets {
  searchApiKey?: string;
}

export const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
  webSearch: { enabled: false, provider: "tavily", maxResults: 5 },
  fetch: { enabled: true },
  code: { autoApprove: false },
};

export function readToolsConfig(): ToolsConfig {
  const stored = getSetting<Partial<ToolsConfig>>("tools.config");
  return {
    webSearch: { ...DEFAULT_TOOLS_CONFIG.webSearch, ...(stored?.webSearch ?? {}) },
    fetch: { ...DEFAULT_TOOLS_CONFIG.fetch, ...(stored?.fetch ?? {}) },
    code: { ...DEFAULT_TOOLS_CONFIG.code, ...(stored?.code ?? {}) },
  };
}

/** Secrets are stored as the same {ciphertext, iv} pair used for provider keys. */
export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
}

export function readSearchApiKey(): string | null {
  const secrets = getSetting<{ searchApiKey?: EncryptedSecret }>("tools.secrets");
  if (!secrets?.searchApiKey?.ciphertext) return null;
  try {
    return decryptText(secrets.searchApiKey.ciphertext, secrets.searchApiKey.iv);
  } catch {
    return null;
  }
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface RawResult {
  title?: string;
  url?: string;
  link?: string;
  content?: string;
  description?: string;
  snippet?: string;
}

interface SearchPayload {
  results?: RawResult[];
  web?: { results?: RawResult[] };
  organic?: RawResult[];
  data?: RawResult[];
}

export class SearchNotConfiguredError extends Error {}
export class SearchError extends Error {}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new SearchError(`Search provider responded with ${response.status}.`);
  return response.json();
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new SearchError(`Search provider responded with ${response.status}.`);
  return response.json();
}

function firstResults(payload: SearchPayload, limit: number): SearchResult[] {
  const rows: RawResult[] = payload.results ?? payload.web?.results ?? payload.organic ?? payload.data ?? [];

  return rows
    .map((row) => ({
      title: row.title ?? row.url ?? row.link ?? "Result",
      url: row.url ?? row.link ?? "",
      snippet: (row.content ?? row.description ?? row.snippet ?? "").slice(0, 400),
    }))
    .filter((row) => row.url.startsWith("http"))
    .slice(0, limit);
}

export async function webSearch(query: string): Promise<SearchResult[]> {
  const config = readToolsConfig().webSearch;
  const apiKey = readSearchApiKey();
  if (!config.enabled) {
    throw new SearchNotConfiguredError("Web search is turned off. Enable it in Settings → Tools.");
  }
  if (config.provider !== "searxng" && !apiKey) {
    throw new SearchNotConfiguredError(
      `No ${config.provider} API key is saved. Add one in Settings → Tools to let the model search the web.`
    );
  }

  const limit = Math.min(Math.max(config.maxResults, 1), 10);

  if (config.provider === "tavily") {
    const payload = (await postJson("https://api.tavily.com/search", { query, max_results: limit, api_key: apiKey }, {})) as SearchPayload;
    return firstResults(payload, limit);
  }

  if (config.provider === "brave") {
    const payload = (await getJson(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
      { accept: "application/json", "x-subscription-token": apiKey ?? "" }
    )) as SearchPayload;
    return firstResults(payload, limit);
  }

  if (config.provider === "serper") {
    const payload = (await postJson(
      "https://google.serper.dev/search",
      { q: query, num: limit },
      { "x-api-key": apiKey ?? "" }
    )) as SearchPayload;
    return firstResults(payload, limit);
  }

  const baseUrl = (config.baseUrl ?? "").replace(/\/+$/, "");
  if (!baseUrl) {
    throw new SearchNotConfiguredError("Add the base URL of your SearXNG instance in Settings → Tools.");
  }
  const payload = (await getJson(`${baseUrl}/search?q=${encodeURIComponent(query)}&format=json`, {
    accept: "application/json",
  })) as SearchPayload;
  return firstResults(payload, limit);
}