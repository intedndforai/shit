import { z } from "zod";
import { jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { encryptText, maskSecret } from "@/lib/crypto";
import { setSetting } from "@/lib/server/settings";
import { TOOL_SPECS, availableToolNames, toolDefinitions } from "@/lib/tools/registry";
import { SEARCH_PROVIDERS, readSearchApiKey, readToolsConfig } from "@/lib/tools/web-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const configSchema = z.object({
  webSearch: z
    .object({
      enabled: z.boolean().optional(),
      provider: z.enum(SEARCH_PROVIDERS).optional(),
      baseUrl: z.string().trim().max(300).optional(),
      maxResults: z.number().int().min(1).max(10).optional(),
    })
    .optional(),
  fetch: z.object({ enabled: z.boolean().optional() }).optional(),
  code: z.object({ autoApprove: z.boolean().optional() }).optional(),
  /** Write-only: never echoed back. `null` clears the stored secret. */
  searchApiKey: z.string().trim().max(400).nullable().optional(),
});

interface ToolsPayload {
  config: ReturnType<typeof readToolsConfig>;
  hasSearchApiKey: boolean;
  maskedSearchApiKey: string;
  available: string[];
  specs: Array<{
    name: string;
    label: string;
    description: string;
    defaultEnabled: boolean;
    requiresConfig: boolean;
    configured: boolean;
    execution: "server" | "client";
    requiresApproval: boolean;
    parameters: Record<string, unknown>;
  }>;
}

function payload(): ToolsPayload {
  const config = readToolsConfig();
  const apiKey = readSearchApiKey();
  const available = availableToolNames();
  const definitions = new Map(
    toolDefinitions(TOOL_SPECS.map((tool) => tool.name)).map((tool) => [tool.name, tool])
  );

  return {
    config,
    hasSearchApiKey: Boolean(apiKey),
    maskedSearchApiKey: maskSecret(apiKey),
    available,
    specs: TOOL_SPECS.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description ?? "",
      defaultEnabled: tool.defaultEnabled,
      requiresConfig: Boolean(tool.requiresConfig),
      configured: available.includes(tool.name),
      execution: tool.execution ?? "server",
      requiresApproval: Boolean(tool.requiresApproval),
      parameters: definitions.get(tool.name)?.parameters ?? {},
    })),
  };
}

/** GET /api/tools — current tool configuration plus the built-in catalogue. */
export async function GET() {
  try {
    return jsonOk(payload());
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * PATCH /api/tools — update tool settings. A supplied `searchApiKey` replaces
 * the stored secret; `searchApiKey: null` clears it.
 */
export async function PATCH(request: Request) {
  const parsed = await parseJson(request, configSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const current = readToolsConfig();
    setSetting("tools.config", {
      webSearch: { ...current.webSearch, ...(parsed.data.webSearch ?? {}) },
      fetch: { ...current.fetch, ...(parsed.data.fetch ?? {}) },
      code: { ...current.code, ...(parsed.data.code ?? {}) },
    });

    if (parsed.data.searchApiKey !== undefined) {
      if (parsed.data.searchApiKey === null || parsed.data.searchApiKey === "") {
        setSetting("tools.secrets", {});
      } else {
        const { ciphertext, iv } = encryptText(parsed.data.searchApiKey);
        setSetting("tools.secrets", { searchApiKey: { ciphertext, iv } });
      }
    }

    return jsonOk(payload());
  } catch (error) {
    return errorResponse(error);
  }
}