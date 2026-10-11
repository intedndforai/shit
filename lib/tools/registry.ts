import type { ToolDefinition } from "@/lib/providers";
import { getAttachment } from "@/lib/files/store";
import { analyseCsv } from "./csv-stats";
import { FetchError, fetchUrl } from "./fetch-url";
import { evaluateExpression, ExpressionError } from "./math";
import { SearchNotConfiguredError, readToolsConfig, searchDestination, webSearch } from "./web-search";
import { UnitError, convertUnits } from "./units";
import { callMcpTool, enabledMcpTools, findToolByExposedName } from "@/lib/mcp/client";
import { customToolsForModel, findCustomToolByExposed, runCustomTool } from "./custom";
import {
  WorkspaceError,
  editFile,
  isCodingTool,
  listFiles,
  readFile,
  runCommand,
  searchFiles,
  writeFile,
} from "./workspace";

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
  /**
   * Where the tool runs. "server" tools are executed inside the route handler;
   * "client" tools are handed to the browser (code runners), which posts the
   * result back and keeps the user's code on their own machine.
   */
  execution?: "server" | "client";
  /** Ask the user before running, then show the output inline. */
  requiresApproval?: boolean;
  /** Where this tool sends data (Section 3.10). */
  dataEgress?: ToolEgressInfo;
}

export interface ToolEgressInfo {
  kind: "none" | "local" | "thirdParty";
  /** Host or short destination, when the tool leaves the machine. */
  destination?: string;
  note?: string;
}

/** Hostname helper that never throws on a malformed URL. */
function hostOf(value: string): string {
  try {
    return new URL(value).hostname || value;
  } catch {
    return value.replace(/^https?:\/\//i, "").split("/")[0] || value;
  }
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
    dataEgress: {
      kind: "thirdParty",
      destination: "search backend",
      note: "Sends the (redacted) search query and nothing else — never the conversation.",
    },
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
    dataEgress: {
      kind: "thirdParty",
      destination: "the URL you fetch",
      note: "Sends the request to the destination host; Conduit sends no cookies, keys, or chat content.",
    },
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
    dataEgress: { kind: "none" },
  },
  {
    name: "current_time",
    label: "Date and time",
    description: "Get the current date and time in ISO 8601 with the server's time zone.",
    parameters: { type: "object", properties: {} },
    defaultEnabled: true,
    dataEgress: { kind: "none" },
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
    dataEgress: { kind: "none" },
  },
  {
    name: "convert_units",
    label: "Convert units",
    description:
      "Convert a value between units of length, mass, volume, time, area, speed, data, energy, or temperature.",
    parameters: {
      type: "object",
      properties: {
        value: { type: "number", description: "The numeric value to convert." },
        from: { type: "string", description: "Source unit, e.g. km, lb, c, GiB." },
        to: { type: "string", description: "Target unit, e.g. mi, kg, f, MB." },
      },
      required: ["value", "from", "to"],
    },
    defaultEnabled: true,
    dataEgress: { kind: "none" },
  },
  {
    name: "run_python",
    label: "Run Python",
    description:
      "Run Python in the user's browser (Pyodide/WebAssembly) and return stdout. numpy, pandas and " +
      "matplotlib are downloaded on demand; figures come back as images. Use conduit_save(name, data) " +
      "to hand the user a file. The user approves each run first, so keep the code focused.",
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "The Python source to execute." } },
      required: ["code"],
    },
    defaultEnabled: true,
    execution: "client",
    requiresApproval: true,
    dataEgress: {
      kind: "thirdParty",
      destination: "cdn.jsdelivr.net",
      note: "Runs in your browser, but Pyodide and its optional packages are fetched from cdn.jsdelivr.net on first use. Disabled in Strict Local mode.",
    },
  },
  {
    name: "run_javascript",
    label: "Run JavaScript",
    description:
      "Run JavaScript in a sandboxed Web Worker in the user's browser. console.log output is captured " +
      "and a top-level return value is shown. No DOM and no network access.",
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "The JavaScript source to execute." } },
      required: ["code"],
    },
    defaultEnabled: true,
    execution: "client",
    requiresApproval: true,
    dataEgress: { kind: "local", note: "Runs in a sandboxed Web Worker in your browser. No network access." },
  },
  {
    name: "list_files",
    label: "List workspace files",
    description:
      "List the files and folders of the coding workspace. Use it first to orient yourself; every path is relative to the workspace root.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder relative to the workspace root. Defaults to the root." },
        depth: { type: "number", description: "How many levels deep to walk. Defaults to 2, maximum 6." },
      },
    },
    defaultEnabled: true,
    dataEgress: { kind: "local", note: "Reads the workspace folder on this machine." },
  },
  {
    name: "read_file",
    label: "Read a workspace file",
    description:
      "Read a text file from the coding workspace with line numbers. Use startLine and endLine for a slice of a long file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File relative to the workspace root." },
        startLine: { type: "number", description: "First line to return, 1-based." },
        endLine: { type: "number", description: "Last line to return, 1-based and inclusive." },
      },
      required: ["path"],
    },
    defaultEnabled: true,
    dataEgress: { kind: "local", note: "Reads a file on this machine." },
  },
  {
    name: "search_files",
    label: "Search workspace files",
    description:
      "Search the coding workspace for a string or regular expression and get file:line matches. node_modules and build output are skipped.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regular expression to look for." },
        path: { type: "string", description: "Folder to search. Defaults to the workspace root." },
        maxResults: { type: "number", description: "Stop after this many matches. Defaults to 30." },
      },
      required: ["query"],
    },
    defaultEnabled: true,
    dataEgress: { kind: "local", note: "Reads workspace files on this machine." },
  },
  {
    name: "write_file",
    label: "Write a workspace file",
    description:
      "Create or replace a file in the coding workspace. The user sees the path and a diff before it is written, so explain the change in your reply.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File relative to the workspace root." },
        content: { type: "string", description: "The complete new contents of the file." },
      },
      required: ["path", "content"],
    },
    defaultEnabled: true,
    requiresApproval: true,
    dataEgress: { kind: "local", note: "Writes a file on this machine after you approve it." },
  },
  {
    name: "edit_file",
    label: "Edit a workspace file",
    description:
      "Replace an exact snippet inside a workspace file. Prefer this over write_file for small changes. Pass replaceAll to change every occurrence.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File relative to the workspace root." },
        find: { type: "string", description: "The exact text to replace, copied from the file." },
        replace: { type: "string", description: "The text to put in its place." },
        replaceAll: { type: "boolean", description: "Replace every occurrence instead of requiring a unique match." },
      },
      required: ["path", "find", "replace"],
    },
    defaultEnabled: true,
    requiresApproval: true,
    dataEgress: { kind: "local", note: "Edits a file on this machine after you approve it." },
  },
  {
    name: "run_command",
    label: "Run a shell command",
    description:
      "Run a shell command inside the coding workspace and return its exit code, stdout and stderr. Needs the user\u2019s approval, and Settings must allow commands.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command line to run." },
        cwd: { type: "string", description: "Folder to run it in, relative to the workspace root." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds. Defaults to 60000, maximum 120000." },
      },
      required: ["command"],
    },
    defaultEnabled: false,
    requiresApproval: true,
    dataEgress: { kind: "local", note: "Runs a command on this machine after you approve it." },
  },
];

export const DEFAULT_TOOL_NAMES = TOOL_SPECS.filter((tool) => tool.defaultEnabled).map((tool) => tool.name);

/**
 * Tools that are usable right now: built-ins (search needs a key), the tools of
 * enabled MCP servers, and the user's custom HTTP tools. MCP and custom tools
 * are opt-in per chat, so they are not part of DEFAULT_TOOL_NAMES.
 */
export function availableToolNames(): string[] {
  const config = readToolsConfig();
  const builtins = TOOL_SPECS.filter((tool) => {
    if (tool.name === "web_search") return config.webSearch.enabled;
    if (tool.name === "fetch_url") return config.fetch.enabled;
    if (tool.name === "run_command") return config.coding.enabled && config.coding.allowCommands;
    if (isCodingTool(tool.name)) return config.coding.enabled;
    return true;
  }).map((tool) => tool.name);

  return [
    ...builtins,
    ...enabledMcpTools().map((entry) => entry.tool.exposed),
    ...customToolsForModel().map((entry) => entry.tool.exposed),
  ];
}

/**
 * Coding tools read their approval rule from Settings, so the spec is rebuilt
 * per call instead of being frozen in TOOL_SPECS.
 */
function codingApproval(spec: ToolSpec): ToolSpec {
  // Only the mutating tools are approval-gated; reads stay frictionless.
  if (!isCodingTool(spec.name) || !spec.requiresApproval) return spec;
  const coding = readToolsConfig().coding;
  return { ...spec, requiresApproval: !coding.autoApproveWrites };
}
/** Spec for a built-in tool, or a synthetic one for an MCP/custom tool. */
export function toolSpec(name: string): ToolSpec | undefined {
  const builtin = TOOL_SPECS.find((spec) => spec.name === name);
  if (builtin) return codingApproval(builtin);

  const mcp = enabledMcpTools().find((entry) => entry.tool.exposed === name);
  if (mcp) {
    return {
      name,
      label: `${mcp.tool.name} · ${mcp.server.name}`,
      description: mcp.tool.description,
      parameters: mcp.tool.inputSchema,
      defaultEnabled: false,
      execution: "server",
      requiresApproval: mcp.server.requiresApproval,
      dataEgress: {
        kind: "thirdParty",
        destination: hostOf(mcp.server.url),
        note: `Sends the tool arguments to the MCP server (${mcp.server.name}).`,
      },
    };
  }

  const custom = customToolsForModel().find((entry) => entry.tool.exposed === name);
  if (custom) {
    return {
      name,
      label: custom.tool.label,
      description: custom.tool.description,
      parameters: custom.tool.parameters,
      defaultEnabled: false,
      execution: "server",
      requiresApproval: custom.tool.requiresApproval,
      dataEgress: {
        kind: "thirdParty",
        destination: hostOf(custom.tool.url),
        note: `Sends the tool arguments to ${custom.tool.label}.`,
      },
    };
  }

  return undefined;
}

/** Egress classification for a tool, resolving live search/MCP/custom destinations. */
export function toolEgress(name: string): ToolEgressInfo {
  const builtin = TOOL_SPECS.find((spec) => spec.name === name);
  if (builtin) {
    if (builtin.name === "web_search") {
      return { ...(builtin.dataEgress ?? { kind: "thirdParty" }), destination: searchDestination() };
    }
    return builtin.dataEgress ?? { kind: "none" };
  }

  const mcp = enabledMcpTools().find((entry) => entry.tool.exposed === name);
  if (mcp) {
    return {
      kind: "thirdParty",
      destination: hostOf(mcp.server.url),
      note: `Sends the tool arguments to the MCP server (${mcp.server.name}).`,
    };
  }

  const custom = customToolsForModel().find((entry) => entry.tool.exposed === name);
  if (custom) {
    return {
      kind: "thirdParty",
      destination: hostOf(custom.tool.url),
      note: `Sends the tool arguments to ${custom.tool.label}.`,
    };
  }

  return { kind: "none" };
}

/** Coarse egress category for the metadata-only log (Section 3.2). */
export function toolEgressKind(name: string): "search" | "fetch" | "mcp" | "custom" | "tool" {
  if (name === "web_search") return "search";
  if (name === "fetch_url") return "fetch";
  if (enabledMcpTools().some((entry) => entry.tool.exposed === name)) return "mcp";
  if (customToolsForModel().some((entry) => entry.tool.exposed === name)) return "custom";
  return "tool";
}

/** True when a tool may run in Strict Local mode (no third-party egress). */
export function isLocallyPermittedTool(name: string): boolean {
  return toolEgress(name).kind !== "thirdParty";
}

export function resolveToolNames(requested?: string[]): string[] {
  const usable = availableToolNames();
  const wanted = requested?.length ? requested : DEFAULT_TOOL_NAMES;
  return wanted.filter((name) => usable.includes(name));
}

export function toolDefinitions(names: string[]): ToolDefinition[] {
  const definitions: ToolDefinition[] = TOOL_SPECS.filter((tool) => names.includes(tool.name)).map(
    ({ name, description, parameters }) => ({ name, description, parameters })
  );

  for (const entry of enabledMcpTools()) {
    if (!names.includes(entry.tool.exposed)) continue;
    definitions.push({
      name: entry.tool.exposed,
      description: `${entry.tool.description} (MCP server: ${entry.server.name})`,
      parameters: entry.tool.inputSchema,
    });
  }

  for (const entry of customToolsForModel()) {
    if (!names.includes(entry.tool.exposed)) continue;
    definitions.push({
      name: entry.tool.exposed,
      description: entry.tool.description,
      parameters: entry.tool.parameters,
    });
  }

  return definitions;
}

/** Everything the Settings and tools menus need, in one call. */
export interface ToolPayload {
  name: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  requiresConfig: boolean;
  configured: boolean;
  execution: "server" | "client";
  requiresApproval: boolean;
  parameters: Record<string, unknown>;
  source: "builtin" | "mcp" | "custom";
  server?: string;
  /** Where the tool sends data; drives the approval dialog (Section 3.10). */
  egress: ToolEgressInfo;
}

export function toolPayloads(): ToolPayload[] {
  const available = new Set(availableToolNames());
  const payloads: ToolPayload[] = TOOL_SPECS.map((spec) => codingApproval(spec)).map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description ?? "",
    defaultEnabled: Boolean(tool.defaultEnabled),
    requiresConfig: Boolean(tool.requiresConfig),
    configured: available.has(tool.name),
    execution: tool.execution ?? "server",
    requiresApproval: Boolean(tool.requiresApproval),
    parameters: tool.parameters ?? {},
    source: "builtin",
    egress: tool.name === "web_search" ? { ...(tool.dataEgress ?? { kind: "thirdParty" as const }), destination: searchDestination() } : tool.dataEgress ?? { kind: "none" as const },
  }));

  for (const entry of enabledMcpTools()) {
    payloads.push({
      name: entry.tool.exposed,
      label: entry.tool.name,
      description: entry.tool.description,
      defaultEnabled: false,
      requiresConfig: false,
      configured: true,
      execution: "server",
      requiresApproval: entry.server.requiresApproval,
      parameters: entry.tool.inputSchema,
      source: "mcp",
      server: entry.server.name,
      egress: { kind: "thirdParty", destination: hostOf(entry.server.url), note: `MCP server: ${entry.server.name}` },
    });
  }

  for (const entry of customToolsForModel()) {
    payloads.push({
      name: entry.tool.exposed,
      label: entry.tool.label,
      description: entry.tool.description,
      defaultEnabled: false,
      requiresConfig: false,
      configured: true,
      execution: "server",
      requiresApproval: entry.tool.requiresApproval,
      parameters: entry.tool.parameters,
      source: "custom",
      egress: { kind: "thirdParty", destination: hostOf(entry.tool.url), note: entry.tool.label },
    });
  }

  return payloads;
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

    if (name === "convert_units") {
      const record = (input ?? {}) as Record<string, unknown>;
      const value = typeof record.value === "number" ? record.value : Number(record.value);
      const from = asString(input, "from");
      const to = asString(input, "to");
      if (!Number.isFinite(value)) return { output: "convert_units needs a numeric `value`.", isError: true };
      if (!from || !to) return { output: "convert_units needs `from` and `to` units.", isError: true };
      const converted = convertUnits(value, from, to);
      return { output: `${converted.text} (${converted.category})`, isError: false };
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

    if (isCodingTool(name)) {
      const record = (input ?? {}) as Record<string, unknown>;
      const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : "");
      const count = (key: string) => (typeof record[key] === "number" ? (record[key] as number) : undefined);
      const flag = (key: string) => record[key] === true;

      if (name === "list_files") {
        return { output: listFiles({ path: text("path"), depth: count("depth") }), isError: false };
      }
      if (name === "read_file") {
        if (!text("path")) return { output: "read_file needs a `path`.", isError: true };
        return {
          output: readFile({ path: text("path"), startLine: count("startLine"), endLine: count("endLine") }),
          isError: false,
        };
      }
      if (name === "search_files") {
        return {
          output: searchFiles({ query: text("query"), path: text("path"), maxResults: count("maxResults") }),
          isError: false,
        };
      }
      if (name === "write_file") {
        if (!text("path")) return { output: "write_file needs a `path`.", isError: true };
        return { output: writeFile({ path: text("path"), content: text("content") }), isError: false };
      }
      if (name === "edit_file") {
        if (!text("path")) return { output: "edit_file needs a `path`.", isError: true };
        return {
          output: editFile({
            path: text("path"),
            find: text("find"),
            replace: text("replace"),
            replaceAll: flag("replaceAll"),
          }),
          isError: false,
        };
      }
      if (name === "run_command") {
        return {
          output: runCommand({ command: text("command"), cwd: text("cwd"), timeoutMs: count("timeoutMs") }),
          isError: false,
        };
      }
    }
    const mcp = findToolByExposedName(name);
    if (mcp) {
      try {
        return { output: clampOutput(await callMcpTool(name, input)), isError: false };
      } catch (error) {
        return {
          output: error instanceof Error ? error.message : "The MCP tool failed.",
          isError: true,
        };
      }
    }

    const custom = findCustomToolByExposed(name);
    if (custom) {
      const result = await runCustomTool(custom, input);
      return { output: clampOutput(result.output), isError: result.isError, citations: result.citations };
    }

    return { output: `Unknown tool: ${name}`, isError: true };
  } catch (error) {
    if (
      error instanceof ExpressionError ||
      error instanceof UnitError ||
      error instanceof FetchError ||
      error instanceof SearchNotConfiguredError ||
      error instanceof WorkspaceError
    ) {
      return { output: error.message, isError: true };
    }
    return {
      output: error instanceof Error ? error.message : "The tool failed.",
      isError: true,
    };
  }
}