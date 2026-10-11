import { z } from "zod";
import { jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { encryptText, maskSecret } from "@/lib/crypto";
import { setSetting } from "@/lib/server/settings";
import { availableToolNames, toolPayloads, type ToolPayload } from "@/lib/tools/registry";
import { SEARCH_PROVIDERS, readSearchApiKey, readToolsConfig } from "@/lib/tools/web-search";
import { workspaceStatus } from "@/lib/tools/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const configSchema = z.object({
  webSearch: z
    .object({
      enabled: z.boolean().optional(),
      provider: z.enum(SEARCH_PROVIDERS).optional(),
      baseUrl: z.string().trim().max(300).optional(),
      endpoint: z.string().trim().max(600).optional(),
      maxResults: z.number().int().min(1).max(10).optional(),
    })
    .optional(),
  fetch: z.object({ enabled: z.boolean().optional() }).optional(),
  code: z.object({ autoApprove: z.boolean().optional() }).optional(),
  coding: z
    .object({
      enabled: z.boolean().optional(),
      root: z.string().trim().max(500).optional(),
      allowCommands: z.boolean().optional(),
      autoApproveWrites: z.boolean().optional(),
      maxReadBytes: z.number().int().min(4_000).max(1_000_000).optional(),
    })
    .optional(),
  /** Write-only: never echoed back. `null` clears the stored secret. */
  searchApiKey: z.string().trim().max(400).nullable().optional(),
});

interface ToolsPayload {
  config: ReturnType<typeof readToolsConfig>;
  hasSearchApiKey: boolean;
  maskedSearchApiKey: string;
  available: string[];
  specs: ToolPayload[];
  /** Where the coding tools would read and write, plus whether they are on. */
  workspace: ReturnType<typeof workspaceStatus>;
}

function payload(): ToolsPayload {
  const config = readToolsConfig();
  const apiKey = readSearchApiKey();

  return {
    config,
    hasSearchApiKey: Boolean(apiKey),
    maskedSearchApiKey: maskSecret(apiKey),
    available: availableToolNames(),
    specs: toolPayloads(),
    workspace: workspaceStatus(),
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
      coding: { ...current.coding, ...(parsed.data.coding ?? {}) },
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