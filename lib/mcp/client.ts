import crypto from "node:crypto";
import { decryptText, encryptText, maskSecret } from "@/lib/crypto";
import { getSetting, setSetting } from "@/lib/server/settings";

/**
 * MCP client.
 *
 * Conduit connects to remote MCP servers the user adds in Settings. Two
 * transports are supported: Streamable HTTP (a single POST endpoint, the current
 * spec) and the legacy HTTP+SSE transport (open a GET stream to learn a message
 * endpoint, then POST JSON-RPC messages to it).
 *
 * Tools are called straight from the server, so the browser never talks to the
 * MCP server and no credentials leave the machine. Server URLs are user-supplied
 * configuration, so local addresses are allowed on purpose -- most MCP servers
 * run on localhost -- while every request still has a timeout and a size cap.
 */

export const MCP_TRANSPORTS = ["http", "sse"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export interface McpTool {
  name: string;
  /** The name the model sees, e.g. `mcp__files__read_file`. */
  exposed: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string | null;
}

export interface McpPrompt {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  enabled: boolean;
  /** Ask the user before running this server's tools. */
  requiresApproval: boolean;
  headers: Array<{ name: string; value: string; secret: boolean }>;
}

export interface McpServerDto {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  enabled: boolean;
  requiresApproval: boolean;
  headers: Array<{ name: string; masked: string; secret: boolean }>;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  lastSyncedAt: number | null;
  error: string | null;
  serverInfo: string | null;
}

export interface McpCacheEntry {
  fetchedAt: number;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  serverInfo: string | null;
  error: string | null;
}

const SERVERS_KEY = "mcp.servers";
const CACHE_KEY = "mcp.cache";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_CHARS = 200_000;

export class McpError extends Error {}

/* ------------------------------------------------------------------ storage */

interface StoredHeader {
  name: string;
  /** Ciphertext for secret headers, plain text otherwise. */
  value: string;
  secret: boolean;
}

interface StoredServer extends Omit<McpServerConfig, "headers"> {
  headers: StoredHeader[];
}

function readServers(): StoredServer[] {
  return getSetting<StoredServer[]>(SERVERS_KEY) ?? [];
}

function writeServers(servers: StoredServer[]): void {
  setSetting(SERVERS_KEY, servers);
}

function readCache(): Record<string, McpCacheEntry> {
  return getSetting<Record<string, McpCacheEntry>>(CACHE_KEY) ?? {};
}

function writeCache(cache: Record<string, McpCacheEntry>): void {
  setSetting(CACHE_KEY, cache);
}

/** Stored secret headers are `${iv}:${ciphertext}` pairs, like provider keys. */
function decryptHeader(header: StoredHeader): string | null {
  if (!header.secret) return header.value;
  const [iv, ciphertext] = header.value.split(":");
  try {
    return decryptText(ciphertext ?? "", iv ?? "");
  } catch {
    return null;
  }
}

function maskValue(header: StoredHeader): string {
  const plain = decryptHeader(header);
  return plain === null ? "saved (unreadable)" : maskSecret(plain);
}

export function listMcpServers(): McpServerDto[] {
  const cache = readCache();
  return readServers().map((server) => {
    const entry = cache[server.id];
    return {
      id: server.id,
      name: server.name,
      url: server.url,
      transport: server.transport,
      enabled: server.enabled,
      requiresApproval: server.requiresApproval,
      headers: server.headers.map((header) => ({
        name: header.name,
        masked: maskValue(header),
        secret: header.secret,
      })),
      toolCount: entry?.tools.length ?? 0,
      resourceCount: entry?.resources.length ?? 0,
      promptCount: entry?.prompts.length ?? 0,
      lastSyncedAt: entry?.fetchedAt ?? null,
      error: entry?.error ?? null,
      serverInfo: entry?.serverInfo ?? null,
    };
  });
}

export interface McpServerInput {
  name: string;
  url: string;
  transport: McpTransport;
  enabled?: boolean;
  requiresApproval?: boolean;
  /** Plain-text values; a value of `null` drops the header. */
  headers?: Array<{ name: string; value: string | null; secret?: boolean }>;
}

function mergeHeaders(
  existing: StoredHeader[],
  incoming: McpServerInput["headers"]
): StoredHeader[] {
  if (!incoming) return existing;
  const merged = new Map(existing.map((header) => [header.name.toLowerCase(), header]));

  for (const header of incoming) {
    const key = header.name.trim().toLowerCase();
    if (!key) continue;
    if (header.value === null) {
      merged.delete(key);
      continue;
    }
    const trimmed = header.value.trim();
    // A value that is only bullet marks means "keep the stored secret".
    if (header.secret !== false && /^[•*]+$/.test(trimmed)) continue;
    const secret = header.secret ?? true;
    const previous = merged.get(key);
    if (secret) {
      if (previous?.secret && decryptHeader(previous) === trimmed) continue;
      const { ciphertext, iv } = encryptText(trimmed);
      merged.set(key, { name: header.name.trim(), value: `${iv}:${ciphertext}`, secret: true });
    } else {
      merged.set(key, { name: header.name.trim(), value: trimmed, secret: false });
    }
  }

  return [...merged.values()];
}

export function createMcpServer(input: McpServerInput): McpServerDto {
  const servers = readServers();
  const server: StoredServer = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    url: input.url.trim().replace(/\/+$/, ""),
    transport: input.transport,
    enabled: input.enabled ?? true,
    requiresApproval: input.requiresApproval ?? false,
    headers: mergeHeaders([], input.headers),
  };
  writeServers([...servers, server]);
  return listMcpServers().find((item) => item.id === server.id) as McpServerDto;
}

export function updateMcpServer(id: string, input: Partial<McpServerInput>): McpServerDto | null {
  const servers = readServers();
  const index = servers.findIndex((server) => server.id === id);
  if (index < 0) return null;
  const current = servers[index];
  const next: StoredServer = {
    ...current,
    name: input.name?.trim() || current.name,
    url: input.url ? input.url.trim().replace(/\/+$/, "") : current.url,
    transport: input.transport ?? current.transport,
    enabled: input.enabled ?? current.enabled,
    requiresApproval: input.requiresApproval ?? current.requiresApproval,
    headers: mergeHeaders(current.headers, input.headers),
  };
  servers[index] = next;
  writeServers(servers);
  return listMcpServers().find((item) => item.id === id) ?? null;
}

export function deleteMcpServer(id: string): boolean {
  const servers = readServers();
  const next = servers.filter((server) => server.id !== id);
  if (next.length === servers.length) return false;
  writeServers(next);
  const cache = readCache();
  delete cache[id];
  writeCache(cache);
  return true;
}

export function serverById(id: string): StoredServer | undefined {
  return readServers().find((server) => server.id === id);
}

export function cacheEntry(id: string): McpCacheEntry | undefined {
  return readCache()[id];
}

function putCache(id: string, entry: McpCacheEntry): void {
  const cache = readCache();
  cache[id] = entry;
  writeCache(cache);
}

/* ------------------------------------------------------------- name mapping */

function slug(value: string, max = 24): string {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (clean || "tool").slice(0, max);
}

/**
 * Provider-safe tool name: `mcp__<server>__<tool>`, capped at 64 characters.
 * A short hash keeps the name stable and collision-free when it has to shrink.
 */
export function exposedToolName(server: { id: string; name: string }, toolName: string): string {
  const hash = crypto.createHash("sha1").update(`${server.id}:${toolName}`).digest("hex").slice(0, 6);
  const serverPart = slug(server.name, 16);
  const room = 64 - "mcp__".length - serverPart.length - "__".length - hash.length - 1;
  const toolPart = slug(toolName, Math.max(8, room));
  return `mcp__${serverPart}__${toolPart}_${hash}`;
}

/** Every cached tool of every enabled server, ready for the model. */
export function enabledMcpTools(): Array<{ server: StoredServer; tool: McpTool }> {
  const cache = readCache();
  const out: Array<{ server: StoredServer; tool: McpTool }> = [];
  for (const server of readServers()) {
    if (!server.enabled) continue;
    for (const tool of cache[server.id]?.tools ?? []) out.push({ server, tool });
  }
  return out;
}

export function findToolByExposedName(exposed: string): { server: StoredServer; tool: McpTool } | undefined {
  return enabledMcpTools().find((entry) => entry.tool.exposed === exposed);
}

/* ---------------------------------------------------------------- transport */

interface RpcResult {
  result?: unknown;
  error?: { code?: number; message?: string };
  sessionId?: string | null;
}

function resolveHeaders(server: StoredServer): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of server.headers) {
    if (!header.name) continue;
    const value = decryptHeader(header);
    if (value !== null) headers[header.name] = value;
  }
  return headers;
}

function parseSsePayload(text: string): unknown[] {
  const payloads: unknown[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      /* ignore keep-alive and malformed frames */
    }
  }
  return payloads;
}

function linkSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return AbortSignal.any ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * One MCP session: initializes the server, then answers `request`/`notify`
 * calls over the negotiated transport.
 */
export class McpConnection {
  private readonly server: StoredServer;
  private readonly signal?: AbortSignal;
  private sessionId: string | null = null;
  private sseEndpoint: string | null = null;
  private sseController: AbortController | null = null;
  private nextId = 1;
  private ready: Promise<void> | null = null;

  constructor(server: StoredServer, signal?: AbortSignal) {
    this.server = server;
    this.signal = signal;
  }

  private get headers(): Record<string, string> {
    return resolveHeaders(this.server);
  }

  private async post(url: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.headers,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: linkSignals(this.signal, REQUEST_TIMEOUT_MS),
      redirect: "follow",
    });
  }

  /** Legacy transport: open the SSE stream and wait for the endpoint event. */
  private async openSse(): Promise<string> {
    if (this.sseEndpoint) return this.sseEndpoint;
    const controller = new AbortController();
    this.sseController = controller;
    const response = await fetch(this.server.url, {
      headers: { accept: "text/event-stream", ...this.headers },
      signal: linkSignals(this.signal, REQUEST_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!response.ok || !response.body) {
      throw new McpError(`The MCP server refused the event stream (HTTP ${response.status}).`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const match = /event:\s*endpoint\s*\r?\ndata:\s*(\S+)/.exec(buffer);
        if (match) {
          const endpoint = match[1];
          this.sseEndpoint = new URL(endpoint, this.server.url).toString();
          return this.sseEndpoint;
        }
      }
    } finally {
      void reader.cancel().catch(() => undefined);
      controller.abort();
      this.sseController = null;
    }
    throw new McpError("The MCP server closed the event stream before sending an endpoint.");
  }

  private async send(method: string, params: unknown): Promise<RpcResult> {
    const url = this.server.transport === "sse" ? await this.openSse() : this.server.url;
    const response = await this.post(url, { jsonrpc: "2.0", id: this.nextId++, method, params });

    if (!response.ok) {
      throw new McpError(`The MCP server answered HTTP ${response.status}.`);
    }
    const sessionHeader = response.headers.get("mcp-session-id");
    if (sessionHeader) this.sessionId = sessionHeader;

    const contentType = response.headers.get("content-type") ?? "";
    const text = (await response.text()).slice(0, MAX_BODY_CHARS);
    if (!text.trim()) return { result: {}, sessionId: this.sessionId };

    const messages = contentType.includes("text/event-stream") ? parseSsePayload(text) : [JSON.parse(text)];
    const message = (messages as Array<Record<string, unknown>>).find(
      (item) => item && (item.result !== undefined || item.error !== undefined)
    ) as RpcResult | undefined;
    if (!message) throw new McpError("The MCP server did not return a JSON-RPC result.");
    return { ...message, sessionId: this.sessionId };
  }

  private async notify(method: string, params: unknown): Promise<void> {
    const url = this.server.transport === "sse" ? await this.openSse() : this.server.url;
    const response = await this.post(url, { jsonrpc: "2.0", method, params });
    if (response.ok) {
      const sessionHeader = response.headers.get("mcp-session-id");
      if (sessionHeader) this.sessionId = sessionHeader;
      await response.arrayBuffer().catch(() => undefined);
    }
  }

  async initialize(): Promise<{ serverInfo: string | null; protocolVersion: string | null }> {
    const response = await this.send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: { roots: { listChanged: false }, sampling: {} },
      clientInfo: { name: "Conduit", version: "0.1.0" },
    });
    if (response.error) throw new McpError(response.error.message ?? "The MCP server rejected the handshake.");
    const result = (response.result ?? {}) as { serverInfo?: { name?: string; version?: string }; protocolVersion?: string };
    await this.notify("notifications/initialized", {});
    const name = result.serverInfo?.name;
    return {
      serverInfo: name ? `${name}${result.serverInfo?.version ? ` ${result.serverInfo.version}` : ""}` : null,
      protocolVersion: result.protocolVersion ?? null,
    };
  }

  private ensureReady(): Promise<void> {
    if (!this.ready) this.ready = this.initialize().then(() => undefined);
    return this.ready;
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    await this.ensureReady();
    const response = await this.send(method, params);
    if (response.error) {
      throw new McpError(response.error.message ?? `The MCP server failed ${method}.`);
    }
    return response.result as T;
  }

  close(): void {
    this.sseController?.abort();
    this.sseController = null;
    this.sseEndpoint = null;
  }
}

/* ------------------------------------------------------------- MCP commands */

interface ListToolsResult {
  tools?: Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }>;
}

interface ListResourcesResult {
  resources?: Array<{ uri?: string; name?: string; description?: string; mimeType?: string }>;
}

interface ListPromptsResult {
  prompts?: Array<{
    name?: string;
    description?: string;
    arguments?: Array<{ name?: string; description?: string; required?: boolean }>;
  }>;
}

interface CallToolResult {
  content?: Array<{ type?: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

interface ReadResourceResult {
  contents?: Array<{ uri?: string; mimeType?: string; text?: string }>;
}

interface GetPromptResult {
  messages?: Array<{ role?: string; content?: { text?: string } | Array<{ text?: string }> }>;
}

function textOfCallTool(result: CallToolResult): string {
  const parts = (result.content ?? [])
    .map((part) => {
      if (part.text) return part.text;
      if (part.type === "image") return `[image ${part.mimeType ?? "image"}]`;
      if (part.data) return `[${part.mimeType ?? "binary"} data omitted]`;
      return "";
    })
    .filter(Boolean);
  return parts.length ? parts.join("\n") : "The tool returned no text.";
}

/** Connects, reads the server's capabilities, and stores them for the registry. */
export async function refreshMcpServer(id: string, signal?: AbortSignal): Promise<McpCacheEntry> {
  const server = serverById(id);
  if (!server) throw new McpError("That MCP server is no longer configured.");

  const connection = new McpConnection(server, signal);
  try {
    const info = await connection.initialize();

    const toolsResult = await connection.request<ListToolsResult>("tools/list", {});
    const tools: McpTool[] = (toolsResult.tools ?? [])
      .filter((tool) => Boolean(tool.name))
      .map((tool) => ({
        name: String(tool.name),
        exposed: exposedToolName(server, String(tool.name)),
        description: tool.description ?? `MCP tool ${tool.name} from ${server.name}.`,
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
      }));

    const resourcesResult = await connection
      .request<ListResourcesResult>("resources/list", {})
      .catch(() => ({ resources: [] }) as ListResourcesResult);
    const resources: McpResource[] = (resourcesResult.resources ?? [])
      .filter((resource) => Boolean(resource.uri))
      .map((resource) => ({
        uri: String(resource.uri),
        name: resource.name ?? String(resource.uri),
        description: resource.description ?? "",
        mimeType: resource.mimeType ?? null,
      }));

    const promptsResult = await connection
      .request<ListPromptsResult>("prompts/list", {})
      .catch(() => ({ prompts: [] }) as ListPromptsResult);
    const prompts: McpPrompt[] = (promptsResult.prompts ?? [])
      .filter((prompt) => Boolean(prompt.name))
      .map((prompt) => ({
        name: String(prompt.name),
        description: prompt.description ?? "",
        arguments: (prompt.arguments ?? []).map((argument) => ({
          name: String(argument.name ?? "argument"),
          description: argument.description ?? "",
          required: Boolean(argument.required),
        })),
      }));

    const entry: McpCacheEntry = {
      fetchedAt: Date.now(),
      tools,
      resources,
      prompts,
      serverInfo: info.serverInfo,
      error: null,
    };
    putCache(id, entry);
    return entry;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The MCP server could not be reached.";
    const previous = cacheEntry(id);
    const entry: McpCacheEntry = {
      fetchedAt: Date.now(),
      tools: previous?.tools ?? [],
      resources: previous?.resources ?? [],
      prompts: previous?.prompts ?? [],
      serverInfo: previous?.serverInfo ?? null,
      error: message,
    };
    putCache(id, entry);
    throw new McpError(message);
  } finally {
    connection.close();
  }
}

export async function callMcpTool(exposed: string, input: unknown): Promise<string> {
  const entry = findToolByExposedName(exposed);
  if (!entry) throw new McpError(`Unknown MCP tool: ${exposed}`);
  const connection = new McpConnection(entry.server);
  try {
    const result = await connection.request<CallToolResult>("tools/call", {
      name: entry.tool.name,
      arguments: (input ?? {}) as Record<string, unknown>,
    });
    const text = textOfCallTool(result);
    if (result.isError) throw new McpError(text);
    return text;
  } finally {
    connection.close();
  }
}

export async function readMcpResource(serverId: string, uri: string): Promise<string> {
  const server = serverById(serverId);
  if (!server) throw new McpError("That MCP server is no longer configured.");
  const connection = new McpConnection(server);
  try {
    const result = await connection.request<ReadResourceResult>("resources/read", { uri });
    const text = (result.contents ?? [])
      .map((content) => content.text ?? `[${content.mimeType ?? "binary"} resource omitted]`)
      .join("\n\n");
    return text || "The resource is empty.";
  } finally {
    connection.close();
  }
}

export async function getMcpPrompt(
  serverId: string,
  name: string,
  args: Record<string, string>
): Promise<string> {
  const server = serverById(serverId);
  if (!server) throw new McpError("That MCP server is no longer configured.");
  const connection = new McpConnection(server);
  try {
    const result = await connection.request<GetPromptResult>("prompts/get", { name, arguments: args });
    return (result.messages ?? [])
      .map((message) => {
        if (!message.content) return "";
        if (Array.isArray(message.content)) return message.content.map((part) => part.text ?? "").join("");
        return message.content.text ?? "";
      })
      .filter(Boolean)
      .join("\n\n");
  } finally {
    connection.close();
  }
}

/** Test button: connect and report what the server offers, without caching. */
export async function testMcpServer(input: {
  url: string;
  transport: McpTransport;
  headers?: Array<{ name: string; value: string | null; secret?: boolean }>;
  id?: string;
}): Promise<{ toolCount: number; resourceCount: number; promptCount: number; serverInfo: string | null }> {
  const server: StoredServer = {
    id: input.id ?? "test",
    name: input.id ? (serverById(input.id)?.name ?? "test") : "test",
    url: input.url.trim().replace(/\/+$/, ""),
    transport: input.transport,
    enabled: true,
    requiresApproval: false,
    headers: mergeHeaders(input.id ? (serverById(input.id)?.headers ?? []) : [], input.headers),
  };
  const connection = new McpConnection(server);
  try {
    const info = await connection.initialize();
    const tools = await connection.request<ListToolsResult>("tools/list", {});
    const resources = await connection
      .request<ListResourcesResult>("resources/list", {})
      .catch(() => ({ resources: [] }) as ListResourcesResult);
    const prompts = await connection
      .request<ListPromptsResult>("prompts/list", {})
      .catch(() => ({ prompts: [] }) as ListPromptsResult);
    return {
      toolCount: (tools.tools ?? []).filter((tool) => Boolean(tool.name)).length,
      resourceCount: (resources.resources ?? []).length,
      promptCount: (prompts.prompts ?? []).length,
      serverInfo: info.serverInfo,
    };
  } finally {
    connection.close();
  }
}