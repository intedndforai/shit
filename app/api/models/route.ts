import { jsonOk, errorResponse } from "@/lib/server/api";
import { listModelOptions } from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/models — every stored model across providers.
 *
 * The @-mention picker and the model-role pickers need one flat,
 * provider-tagged list; fetching it per provider would be N round-trips.
 */
export async function GET() {
  try {
    return jsonOk({ models: listModelOptions() });
  } catch (error) {
    return errorResponse(error);
  }
}