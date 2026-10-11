import { jsonOk, errorResponse } from "@/lib/server/api";
import { listArtifacts } from "@/lib/server/artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/artifacts?chatId= — latest version of each artifact. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const chatId = url.searchParams.get("chatId") ?? undefined;
    return jsonOk({ artifacts: listArtifacts(chatId) });
  } catch (error) {
    return errorResponse(error);
  }
}