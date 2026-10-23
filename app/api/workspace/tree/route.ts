import { jsonOk, errorResponse } from "@/lib/server/api";
import { fileTree, workspaceStatus, WorkspaceError } from "@/lib/tools/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/tree?path=&depth= — the workspace folder as a flat list.
 *
 * Returns the status alongside the tree so the page can render the setup state
 * (switched off, folder missing) without a second round trip.
 */
export async function GET(request: Request) {
  const status = workspaceStatus();
  if (!status.enabled) {
    return jsonOk({ status, nodes: [] });
  }

  const url = new URL(request.url);
  try {
    const nodes = fileTree({
      path: url.searchParams.get("path") ?? "",
      depth: Number(url.searchParams.get("depth") ?? 3),
    });
    return jsonOk({ status, nodes });
  } catch (error) {
    if (error instanceof WorkspaceError) return jsonOk({ status, nodes: [], note: error.message });
    return errorResponse(error);
  }
}
