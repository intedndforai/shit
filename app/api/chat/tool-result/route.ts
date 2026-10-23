import { z } from "zod";
import { jsonError, jsonOk, parseJson } from "@/lib/server/api";
import { denyClientTool, resolveClientTool } from "@/lib/server/pending-tools";

const bodySchema = z.object({
  id: z.string().min(1),
  /** The chat that owns the pending call. A mismatch leaves the call parked. */
  chatId: z.string().min(1),
  /** "deny" records a refusal; anything else delivers the runner's output. */
  decision: z.enum(["run", "deny"]).default("run"),
  output: z.string().max(200_000).optional(),
  isError: z.boolean().optional(),
});

/**
 * Outcome of a browser-executed tool call (see lib/server/pending-tools.ts).
 *
 * Three gates before anything settles:
 *  1. `sec-fetch-site: cross-site` is refused - browsers set it and script cannot
 *     forge it, so a page on another origin cannot approve anything.
 *  2. The content type must be application/json. A CORS-safelisted type such as
 *     text/plain would otherwise let a cross-site simple fetch reach us.
 *  3. The body must carry the chat id that owns the pending call.
 * Unknown ids and chat mismatches answer identically (404, same wording) so a
 * probe cannot distinguish a live id from a dead one.
 */
export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return jsonError("Cross-site requests cannot resolve tool calls.", 403);
  }
  const declaredType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (declaredType !== "application/json") {
    return jsonError("Request body must be JSON with an application/json content type.", 415);
  }

  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  const { id, chatId, decision, output, isError } = parsed.data;

  if (decision === "deny") {
    return denyClientTool(id, chatId)
      ? jsonOk({ ok: true, decision: "deny" })
      : jsonError("That tool call is no longer waiting for a decision.", 404);
  }

  const delivered = resolveClientTool(id, { output: output ?? "", isError: Boolean(isError) }, chatId);
  if (!delivered) return jsonError("That tool call is no longer waiting for a result.", 404);
  return jsonOk({ ok: true });
}