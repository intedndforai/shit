import { jsonOk, errorResponse } from "@/lib/server/api";
import { searchEverything } from "@/lib/server/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/search?q=term — searches chat titles and message content. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim();
    if (query.length < 2) return jsonOk({ query, hits: [] });
    return jsonOk({ query, hits: searchEverything(query) });
  } catch (error) {
    return errorResponse(error);
  }
}