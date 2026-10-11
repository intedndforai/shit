import type { ToolDefinition } from "@/lib/providers";
import { getAttachment } from "@/lib/files/store";
import { analyseCsv } from "./csv-stats";
import { FetchError, fetchUrl } from "./fetch-url";
import { evaluateExpression, ExpressionError } from "./math";
import { SearchNotConfiguredError, readToolsConfig, webSearch } from "./web-search";

/**
 * Built-in tool registry.
 *
 * The chat pipeline asks for `ToolDefinition`s (the vendor-neutral JSON the
 * adapters translate), and executes tool calls through `runTool`. Every tool
 * returns text for the model plus optional citations for the UI.
 */

export interface ToolSpec extends ToolDefinition {
  label: string;
  /** Offered to models by default; users can still turn each one off. */
  defaultEnabled: boolean;
  /** Only offered when the user has configured the backing service. */
  requiresConfig?: boolean;
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "web_search",
    label: "Web search",
    description:
      "Search the web for current information. Use it for facts that may have changed, news, or anything you are unsure about, then cite the URLs you used.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "The search query." } },
      required: ["query"],
    },
    defaultEnabled: true,
    requiresConfig: true,
  },
  {
    name: "fetch_url",
    label: "Fetch a URL",
    description:
      "Fetch the text content of a public http(s) URL. Use it to read a page found through web_search. Private and local addresses are blocked.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "The absolute URL to read." } },
      required: ["url"],
    },
    defaultEnabled: true,
  },
  {
    name: "calculator",
    label: "Calculator",
    description:
      "Evaluate an arithmetic expression exactly. Supports + - * / % ^, parentheses, and sqrt/abs/round/floor/ceil/ln/log10/exp/sin/cos/tan.",
    parameters: {
      type: "object",
      properties: { expression: { type: "string", description: "e.g. (12.5 * 4) ^ 2 + sqrt(9)" } },
      required: ["expression"],
    },
    defaultEnabled: true,
  },
  {
    name: "current_time",
    label: "Date and time",
    description: "Get the current date and time in ISO 8601 with the server's time zone.",
    parameters: { type: "object", properties: {} },
    defaultEnabled: true,
  },
  {
    name: "analyze_csv",
    label: "Analyse CSV",
    description:
      "Compute column statistics (types, min/max/mean, distinct counts, top values) for CSV text or for a CSV attachment in this conversation.",
    parameters: {
      type: "object",
      properties: {
        csv: { type: "string", description: "Raw CSV text, including a header row." },
        attachmentId: { type: "string", description: "Id of an uploaded CSV attachment instead of raw text." },
      },
    },
    defaultEnabled: true,
  },
];

export const DEFAULT_TOOL_NAMES = TOOL_SPECS.filter((tool) => tool.defaultEnabled).map((tool) => tool.name);

/** Tools that are actually usable right now (search needs a configured key). */
export function availableToolNames(): string[] {
  const config = readToolsConfig();
  return TOOL_SPECS.filter((tool) => {
    if (tool.name === "web_search") return config.webSearch.enabled;
    if (tool.name === "fetch_url") return config.fetch.enabled;
    return true;
  }).map((tool) => tool.name);
}

export function resolveToolNames(requested?: string[]): string[] {
  const usable = availableToolNames();
  const wanted = requested?.length ? requested : DEFAULT_TOOL_NAMES;
  return wanted.filter((name) => usable.includes(name));
}

export function toolDefinitions(names: string[]): ToolDefinition[] {
  return TOOL_SPECS.filter((tool) => names.includes(tool.name)).map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

export interface ToolCitation {
  title: string;
  url: string;
}

export interface ToolRunResult {
  output: string;
  isError: boolean;
  citations?: ToolCitation[];
}

function asString(input: unknown, key: string): string {
  const value = (input as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "string" ? value.trim() : "";
}

const MAX_TOOL_OUTPUT = 12_000;

function clampOutput(text: string): string {
  return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n…[truncated]` : text;
}

export async function runTool(name: string, input: unknown): Promise<ToolRunResult> {
  try {
    if (name === "calculator") {
      const expression = asString(input, "expression");
      if (!expression) return { output: "The calculator needs an `expression`.", isError: true };
      const value = evaluateExpression(expression);
      return { output: `${expression} = ${value}`, isError: false };
    }

    if (name === "current_time") {
      const now = new Date();
      return {
        output: JSON.stringify({
          iso: now.toISOString(),
          local: now.toString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        isError: false,
      };
    }

    if (name === "web_search") {
      const query = asString(input, "query");
      if (!query) return { output: "web_search needs a `query`.", isError: true };
      const results = await webSearch(query);
      if (!results.length) return { output: `No results for “${query}”.`, isError: false };
      return {
        output: clampOutput(
          results.map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`).join("\n\n")
        ),
        isError: false,
        citations: results.map((result) => ({ title: result.title, url: result.url })),
      };
    }

    if (name === "fetch_url") {
      const url = asString(input, "url");
      if (!url) return { output: "fetch_url needs a `url`.", isError: true };
      const page = await fetchUrl(url);
      return {
        output: clampOutput(`# ${page.url}\n(${page.status} ${page.contentType}${page.truncated ? ", truncated" : ""})\n\n${page.text}`),
        isError: false,
        citations: [{ title: page.url, url: page.url }],
      };
    }

    if (name === "analyze_csv") {
      const inline = asString(input, "csv");
      let csv = inline;
      if (!csv) {
        const attachmentId = asString(input, "attachmentId");
        if (attachmentId) {
          const row = getAttachment(attachmentId);
          csv = row?.text ?? "";
        }
      }
      if (!csv) return { output: "Provide `csv` text or the `attachmentId` of a CSV you uploaded.", isError: true };
      const stats = analyseCsv(csv);
      return { output: clampOutput(JSON.stringify(stats, null, 2)), isError: false };
    }

    return { output: `Unknown tool: ${name}`, isError: true };
  } catch (error) {
    if (
      error instanceof ExpressionError ||
      error instanceof FetchError ||
      error instanceof SearchNotConfiguredError
    ) {
      return { output: error.message, isError: true };
    }
    return {
      output: error instanceof Error ? error.message : "The tool failed.",
      isError: true,
    };
  }
}