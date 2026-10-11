import { jsonOk, errorResponse } from "@/lib/server/api";
import { clearEgress, destinationSummary, listEgress } from "@/lib/server/privacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/privacy/egress — the metadata-only egress log. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const chatId = url.searchParams.get("chatId") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? "100");
    return jsonOk({
      events: listEgress({ chatId, limit: Number.isFinite(limit) ? limit : 100 }),
      destinations: destinationSummary(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/privacy/egress — clear the log (all of it, or one chat). */
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const chatId = url.searchParams.get("chatId") ?? undefined;
    return jsonOk({ ok: true, cleared: clearEgress(chatId) });
  } catch (error) {
    return errorResponse(error);
  }
}
