import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import {
  MCP_TRANSPORTS,
  McpError,
  createMcpServer,
  listMcpServers,
  refreshMcpServer,
} from "@/lib/mcp/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headerSchema = z.array(
  z.object({
    name: z.string().trim().min(1).max(120),
    value: z.string().max(4000).nullable(),
    secret: z.boolean().optional(),
  })
);

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(400),
  transport: z.enum(MCP_TRANSPORTS).default("http"),
  enabled: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  headers: headerSchema.optional(),
});

/** GET /api/mcp -- the configured servers plus their cached capabilities. */
export async function GET() {
  try {
    return jsonOk({ servers: listMcpServers(), transports: MCP_TRANSPORTS });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/mcp -- add a server and read its tool list straight away. */
export async function POST(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  try {
    const server = createMcpServer(parsed.data);
    let synced = false;
    let syncError: string | null = null;
    try {
      await refreshMcpServer(server.id);
      synced = true;
    } catch (error) {
      syncError = error instanceof McpError ? error.message : "The server could not be reached.";
    }
    return jsonOk({ servers: listMcpServers(), serverId: server.id, synced, syncError }, 201);
  } catch (error) {
    if (error instanceof McpError) return jsonError(error.message, 400);
    return errorResponse(error);
  }
}