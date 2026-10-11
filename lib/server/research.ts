import { getAdapter } from "@/lib/providers";
import { connectionFromProvider } from "@/lib/server/providers";
import type { Provider } from "@/lib/db/schema";
import { fetchUrl } from "@/lib/tools/fetch-url";
import { readToolsConfig, webSearch } from "@/lib/tools/web-search";

/**
 * Deep Research.
 *
 * A three-phase pipeline that runs before the answering model speaks:
 *   1. plan    -- one cheap completion turns the question into search queries
 *   2. gather  -- those queries run in parallel, then the best pages are fetched
 *   3. answer  -- the excerpts are injected into the system prompt and the model
 *                 writes the report, citing the numbered sources
 *
 * Every phase reports progress through `onStep`, so the transcript can show a
 * live timeline, and every network call passes the caller's abort signal, so the
 * Stop button cancels the whole run.
 */

export type ResearchStepStatus = "running" | "done" | "error" | "skipped";

export interface ResearchStep {
  id: string;
  label: string;
  status: ResearchStepStatus;
  detail?: string;
}

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  excerpt: string;
}

const MAX_QUERIES = 5;
const MAX_SOURCES = 12;
const EXCERPT_CHARS = 1200;

/** First `[` to last `]`; models like to wrap JSON in prose or fences. */
function parseQueryList(text: string): string[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 2);
  } catch {
    return [];
  }
}

export async function planResearchQueries(options: {
  question: string;
  provider: Provider;
  model: string;
  signal?: AbortSignal;
  maxQueries?: number;
}): Promise<string[]> {
  const adapter = getAdapter(options.provider.apiFormat as never);
  const connection = connectionFromProvider(options.provider);
  const limit = options.maxQueries ?? MAX_QUERIES;

  let text = "";
  try {
    for await (const event of adapter.stream({
      ...connection,
      model: options.model,
      system:
        `You plan web research. Reply with a JSON array of at most ${limit} short search queries that together ` +
        "answer the user's question. Cover different angles, prefer specific terms over full sentences, and " +
        "reply with the JSON array and nothing else.",
      messages: [{ role: "user", content: [{ kind: "text", text: options.question.slice(0, 4000) }] }],
      maxTokens: 400,
      temperature: 0.2,
      signal: options.signal,
    })) {
      if (event.type === "text_delta") text += event.text;
    }
  } catch {
    /* fall back to the raw question */
  }

  const queries = [...new Set(parseQueryList(text))].slice(0, limit);
  return queries.length ? queries : [options.question.slice(0, 300)];
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await run(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function gatherResearchSources(options: {
  queries: string[];
  signal?: AbortSignal;
  perQuery?: number;
  pagesPerQuery?: number;
  onStep: (step: ResearchStep) => void;
}): Promise<ResearchSource[]> {
  const config = readToolsConfig().webSearch;
  const perQuery = Math.min(options.perQuery ?? config.maxResults, 10);
  const pagesPerQuery = options.pagesPerQuery ?? 2;

  const searchResults = await mapLimit(options.queries, 3, async (query, index) => {
    const stepId = `search-${index}`;
    options.onStep({ id: stepId, label: `Searching “${query}”`, status: "running" });
    if (options.signal?.aborted) {
      options.onStep({ id: stepId, label: `Searching “${query}”`, status: "skipped" });
      return [];
    }
    try {
      const results = await webSearch(query);
      const trimmed = results.slice(0, perQuery);
      options.onStep({
        id: stepId,
        label: `Searched “${query}”`,
        status: "done",
        detail: `${trimmed.length} result${trimmed.length === 1 ? "" : "s"}`,
      });
      return trimmed;
    } catch (error) {
      options.onStep({
        id: stepId,
        label: `Search failed for “${query}”`,
        status: "error",
        detail: error instanceof Error ? error.message : "search failed",
      });
      return [];
    }
  });

  const ordered = searchResults.flat();
  const seen = new Set<string>();
  const candidates = ordered.filter((result) => {
    if (!result.url.startsWith("http") || seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });

  const toFetch = candidates.slice(0, Math.max(pagesPerQuery * options.queries.length, pagesPerQuery));
  const pages = await mapLimit(toFetch, 3, async (result, index) => {
    const stepId = `fetch-${index}`;
    options.onStep({ id: stepId, label: `Reading ${result.url}`, status: "running" });
    if (options.signal?.aborted) {
      options.onStep({ id: stepId, label: `Skipped ${result.url}`, status: "skipped" });
      return null;
    }
    try {
      const page = await fetchUrl(result.url);
      const excerpt = page.text.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS);
      options.onStep({
        id: stepId,
        label: `Read ${page.url}`,
        status: "done",
        detail: `${page.text.length.toLocaleString()} characters`,
      });
      return { ...result, excerpt };
    } catch (error) {
      options.onStep({
        id: stepId,
        label: `Could not read ${result.url}`,
        status: "error",
        detail: error instanceof Error ? error.message : "fetch failed",
      });
      // Keep the search snippet: a failed fetch should not lose the source.
      return { ...result, excerpt: result.snippet };
    }
  });

  const fetched = pages.filter((page): page is ResearchSource => Boolean(page));
  const byUrl = new Map(fetched.map((page) => [page.url, page]));
  for (const result of candidates) {
    if (byUrl.size >= MAX_SOURCES) break;
    if (!byUrl.has(result.url)) byUrl.set(result.url, { ...result, excerpt: result.snippet });
  }
  return [...byUrl.values()].slice(0, MAX_SOURCES);
}

/** The numbered source block handed to the answering model. */
export function buildResearchContext(question: string, sources: ResearchSource[]): string {
  const lines = sources.map(
    (source, index) => `[${index + 1}] ${source.title}\n${source.url}\n${source.excerpt}`
  );
  return [
    "You are writing a research report.",
    `The question was: ${question.slice(0, 600)}`,
    "Use the numbered sources below as your evidence and cite them inline as [1], [2], and so on.",
    "Be specific, note disagreements between sources, and finish with a short “Sources” list of the numbers you used.",
    "",
    ...lines,
  ].join("\n\n");
}