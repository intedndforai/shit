import crypto from "node:crypto";
import { decryptText, encryptText, maskSecret } from "@/lib/crypto";
import { getSetting, setSetting } from "@/lib/server/settings";

/**
 * Custom tools: small HTTP endpoints the user describes with a JSON schema.
 *
 * The definition is a name the model sees, a description, an HTTP method and
 * URL, optional headers (stored encrypted), and a JSON Schema for the
 * arguments. Conduit turns the model's arguments into a query string (GET) or a
 * JSON body (POST) and hands the response text back.
 *
 * The URL is explicit user configuration, so private and loopback hosts are
 * allowed -- pointing a tool at an internal API is the point -- while requests
 * stay bounded by a timeout and a response size cap.
 */

export const CUSTOM_METHODS = ["GET", "POST"] as const;
export type CustomMethod = (typeof CUSTOM_METHODS)[number];

const STORE_KEY = "tools.custom";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARS = 20_000;

export class CustomToolError extends Error {}

interface StoredHeader {
  name: string;
  /** Ciphertext for secret headers, plain text otherwise. */
  value: string;
  secret: boolean;
}

interface StoredCustomTool {
  id: string;
  exposed: string;
  label: string;
  description: string;
  method: CustomMethod;
  url: string;
  headers: StoredHeader[];
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  enabled: boolean;
}

export interface CustomToolDto {
  id: string;
  exposed: string;
  label: string;
  description: string;
  method: CustomMethod;
  url: string;
  headers: Array<{ name: string; masked: string; secret: boolean }>;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  enabled: boolean;
}

export interface CustomToolInput {
  label: string;
  description?: string;
  method: CustomMethod;
  url: string;
  parameters?: Record<string, unknown>;
  requiresApproval?: boolean;
  enabled?: boolean;
  /** Plain-text values; `null` removes the header, bullets keep the saved one. */
  headers?: Array<{ name: string; value: string | null; secret?: boolean }>;
}

function readTools(): StoredCustomTool[] {
  return getSetting<StoredCustomTool[]>(STORE_KEY) ?? [];
}

function writeTools(tools: StoredCustomTool[]): void {
  setSetting(STORE_KEY, tools);
}

function slug(value: string, max = 30): string {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (clean || "tool").slice(0, max);
}

/** Provider-safe name, e.g. `custom__lookup_weather_a1b2c3`. */
export function customToolName(label: string): string {
  const hash = crypto.createHash("sha1").update(`${label}:${crypto.randomUUID()}`).digest("hex").slice(0, 6);
  return `custom__${slug(label, 40)}_${hash}`;
}

function decryptHeader(header: StoredHeader): string | null {
  if (!header.secret) return header.value;
  const [iv, ciphertext] = header.value.split(":");
  try {
    return decryptText(ciphertext ?? "", iv ?? "");
  } catch {
    return null;
  }
}

function toDto(tool: StoredCustomTool): CustomToolDto {
  return {
    id: tool.id,
    exposed: tool.exposed,
    label: tool.label,
    description: tool.description,
    method: tool.method,
    url: tool.url,
    headers: tool.headers.map((header) => ({
      name: header.name,
      masked: header.secret ? maskSecret(decryptHeader(header) ?? "") : header.value,
      secret: header.secret,
    })),
    parameters: tool.parameters,
    requiresApproval: tool.requiresApproval,
    enabled: tool.enabled,
  };
}

function mergeHeaders(existing: StoredHeader[], incoming: CustomToolInput["headers"]): StoredHeader[] {
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
    if (header.secret !== false && /^[•*]+$/.test(trimmed)) continue;
    if (header.secret === false) {
      merged.set(key, { name: header.name.trim(), value: trimmed, secret: false });
      continue;
    }
    const previous = merged.get(key);
    if (previous?.secret && decryptHeader(previous) === trimmed) continue;
    const { ciphertext, iv } = encryptText(trimmed);
    merged.set(key, { name: header.name.trim(), value: `${iv}:${ciphertext}`, secret: true });
  }

  return [...merged.values()];
}

function normaliseSchema(parameters: unknown): Record<string, unknown> {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new CustomToolError("The arguments schema must be a JSON object.");
  }
  const schema = parameters as Record<string, unknown>;
  const type = schema.type;
  if (type !== undefined && type !== "object") {
    throw new CustomToolError('The arguments schema must have "type": "object".');
  }
  return { type: "object", properties: {}, ...schema };
}

export function listCustomTools(): CustomToolDto[] {
  return readTools().map(toDto);
}

export function customToolsForModel(): Array<{ tool: StoredCustomTool }> {
  return readTools()
    .filter((tool) => tool.enabled)
    .map((tool) => ({ tool }));
}

export function findCustomToolByExposed(exposed: string): StoredCustomTool | undefined {
  return readTools().find((tool) => tool.exposed === exposed && tool.enabled);
}

export function createCustomTool(input: CustomToolInput): CustomToolDto {
  const tools = readTools();
  if (tools.some((tool) => tool.label.toLowerCase() === input.label.trim().toLowerCase())) {
    throw new CustomToolError("A tool with that name already exists.");
  }
  const tool: StoredCustomTool = {
    id: crypto.randomUUID(),
    exposed: customToolName(input.label.trim()),
    label: input.label.trim(),
    description: input.description?.trim() || `Call ${input.label.trim()} over HTTP.`,
    method: input.method,
    url: input.url.trim(),
    headers: mergeHeaders([], input.headers),
    parameters: normaliseSchema(input.parameters ?? {}),
    requiresApproval: input.requiresApproval ?? false,
    enabled: input.enabled ?? true,
  };
  writeTools([...tools, tool]);
  return toDto(tool);
}

export function updateCustomTool(id: string, input: Partial<CustomToolInput>): CustomToolDto | null {
  const tools = readTools();
  const index = tools.findIndex((tool) => tool.id === id);
  if (index < 0) return null;
  const current = tools[index];
  const next: StoredCustomTool = {
    ...current,
    label: input.label?.trim() || current.label,
    description: input.description?.trim() || current.description,
    method: input.method ?? current.method,
    url: input.url?.trim() || current.url,
    headers: mergeHeaders(current.headers, input.headers),
    parameters: input.parameters ? normaliseSchema(input.parameters) : current.parameters,
    requiresApproval: input.requiresApproval ?? current.requiresApproval,
    enabled: input.enabled ?? current.enabled,
  };
  tools[index] = next;
  writeTools(tools);
  return toDto(next);
}

export function deleteCustomTool(id: string): boolean {
  const tools = readTools();
  const next = tools.filter((tool) => tool.id !== id);
  if (next.length === tools.length) return false;
  writeTools(next);
  return true;
}

function asQuery(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Runs one stored tool with the model's arguments. */
export async function runCustomTool(
  tool: StoredCustomTool,
  input: unknown
): Promise<{ output: string; isError: boolean; citations?: Array<{ title: string; url: string }> }> {
  const args = (input ?? {}) as Record<string, unknown>;
  const headers: Record<string, string> = { accept: "application/json, text/plain;q=0.9, */*;q=0.8" };

  for (const header of tool.headers) {
    const value = decryptHeader(header);
    if (value !== null) headers[header.name] = value;
  }

  let url = tool.url;
  let body: string | undefined;
  if (tool.method === "GET") {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(args)) {
      const text = asQuery(value);
      if (text) query.set(key, text);
    }
    const separator = url.includes("?") ? "&" : "?";
    if ([...query].length) url = `${url}${separator}${query.toString()}`;
  } else {
    headers["content-type"] = "application/json";
    body = JSON.stringify(args);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: tool.method,
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (error) {
    return {
      output: `The tool request failed: ${error instanceof Error ? error.message : "network error"}.`,
      isError: true,
    };
  }

  const raw = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
  const contentType = response.headers.get("content-type") ?? "";
  let text = raw;
  if (contentType.includes("json")) {
    try {
      text = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      /* keep the raw body when it is not actually JSON */
    }
  }

  return {
    output: `HTTP ${response.status} ${response.statusText}\n\n${text || "(empty response)"}`,
    isError: !response.ok,
    citations: [{ title: `${tool.label} (${tool.method} ${tool.url})`, url: tool.url }],
  };
}

/** Test button: run the definition as stored with empty arguments. */
export async function testCustomTool(id: string): Promise<{ status: number; preview: string }> {
  const tool = readTools().find((item) => item.id === id);
  if (!tool) throw new CustomToolError("That tool is no longer configured.");
  const result = await runCustomTool(tool, {});
  const status = Number(/^HTTP (\d+)/.exec(result.output)?.[1] ?? 0);
  return { status, preview: result.output.slice(0, 600) };
}