import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { deriveStyleInstructions } from "@/lib/server/styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ sample: z.string().min(40).max(20000) });

/** POST /api/styles/from-sample -- derive style instructions from a writing sample. */
export async function POST(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    const instructions = await deriveStyleInstructions(parsed.data.sample);
    if (!instructions) {
      return jsonError(
        "Conduit could not derive a style. Check that a provider and model are configured, or write the instructions yourself.",
        409
      );
    }
    return jsonOk({ instructions });
  } catch (error) {
    return errorResponse(error);
  }
}