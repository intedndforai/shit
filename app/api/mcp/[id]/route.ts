import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import {
  MCP_TRANSPORTS,
  McpError,
  cacheEntry,
  deleteMcpServer,
  getMcpPrompt,
  listMcpServers,
  readMcpResource,
  refreshMcpServer,
  testMcpServer,
  updateMcpServer,
} from "@/lib/mcp/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: z.string().trim().url().max(400).optional(),
  transport: z.enum(MCP_TRANSPORTS).optional(),
  enabled: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  headers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        value: z.string().max(4000).nullable(),
        secret: z.boolean().optional(),
      })
    )
    .optional(),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refresh") }),
  z.object({
    action: z.literal("test"),
    url: z.string().trim().url().max(400),
    transport: z.enum(MCP_TRANSPORTS).default("http"),
    headers: patchSchema.shape.headers,
  }),
  z.object({ action: z.literal("resource"), uri: z.string().min(1).max(2000) }),
  z.object({
    action: z.literal("prompt"),
    name: z.string().min(1).max(200),
    args: z.record(z.string(), z.string().max(4000)).optional(),
  }),
]);

/** POST /api/mcp/:id -- refresh a server, test a draft, read a resource, or render a prompt. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, actionSchema);
  if (!parsed.ok) return parsed.response;

  try {
    if (parsed.data.action === "refresh") {
      const cache = await refreshMcpServer(id);
      return jsonOk({
        servers: listMcpServers(),
        cache: {
          toolCount: cache.tools.length,
          resourceCount: cache.resources.length,
          promptCount: cache.prompts.length,
          serverInfo: cache.serverInfo,
        },
      });
    }

    if (parsed.data.action === "test") {
      const result = await testMcpServer({
        url: parsed.data.url,
        transport: parsed.data.transport,
        headers: parsed.data.headers,
        id,
      });
      return jsonOk({ test: result });
    }

    if (parsed.data.action === "resource") {
      const text = await readMcpResource(id, parsed.data.uri);
      return jsonOk({ text });
    }

    const text = await getMcpPrompt(id, parsed.data.name, parsed.data.args ?? {});
    return jsonOk({ text });
  } catch (error) {
    if (error instanceof McpError) return jsonError(error.message, 400);
    return errorResponse(error);
  }
}

/** PATCH /api/mcp/:id -- change a server's details, headers, or approval policy. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const server = updateMcpServer(id, parsed.data);
    if (!server) return jsonError("That MCP server is no longer configured.", 404);
    return jsonOk({ server, servers: listMcpServers() });
  } catch (error) {
    if (error instanceof McpError) return jsonError(error.message, 400);
    return errorResponse(error);
  }
}

/** DELETE /api/mcp/:id -- forget a server and everything cached about it. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const removed = deleteMcpServer(id);
    if (!removed) return jsonError("That MCP server is no longer configured.", 404);
    return jsonOk({ servers: listMcpServers() });
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET /api/mcp/:id -- the cached capabilities of one server. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const server = listMcpServers().find((item) => item.id === id);
  if (!server) return jsonError("That MCP server is no longer configured.", 404);
  return jsonOk({ server, cache: cacheEntry(id) ?? null });
}