import { z } from "zod";
import { jsonError, jsonOk, parseJson } from "@/lib/server/api";
import { denyClientTool, resolveClientTool } from "@/lib/server/pending-tools";

const bodySchema = z.object({
  id: z.string().min(1),
  /** "deny" records a refusal; anything else delivers the runner's output. */
  decision: z.enum(["run", "deny"]).default("run"),
  output: z.string().max(200_000).optional(),
  isError: z.boolean().optional(),
});

/**
 * Outcome of a browser-executed tool call (see lib/server/pending-tools.ts).
 *
 * The page posts here after running Python or JavaScript in a worker; the
 * waiting chat stream picks the result up and feeds it to the model.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  const { id, decision, output, isError } = parsed.data;

  if (decision === "deny") {
    return denyClientTool(id)
      ? jsonOk({ ok: true, decision: "deny" })
      : jsonError("That tool call is no longer waiting for a decision.", 404);
  }

  const delivered = resolveClientTool(id, { output: output ?? "", isError: Boolean(isError) });
  if (!delivered) return jsonError("That tool call is no longer waiting for a result.", 404);
  return jsonOk({ ok: true });
}