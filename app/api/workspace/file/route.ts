import { z } from "zod";
import { errorResponse, jsonError, jsonOk, parseJson } from "@/lib/server/api";
import {
  readWorkspaceFile,
  workspaceStatus,
  writeWorkspaceFile,
  WorkspaceError,
} from "@/lib/tools/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/file?path= — read one file for the editor.
 * PUT /api/workspace/file — write one file from the editor.
 *
 * These are the user acting directly in the toolbox, not the model, so there is
 * no approval step. The same guards still apply: the path must resolve inside
 * the configured root, and a file whose name looks like a secret is refused.
 */
export async function GET(request: Request) {
  try {
    const path = new URL(request.url).searchParams.get("path") ?? "";
    if (!path) return jsonError("A `path` is required.", 400);
    return jsonOk({ file: readWorkspaceFile({ path }), status: workspaceStatus() });
  } catch (error) {
    if (error instanceof WorkspaceError) return jsonError(error.message, 400);
    return errorResponse(error);
  }
}

const putSchema = z.object({
  path: z.string().min(1).max(1024),
  content: z.string().max(2_000_000),
});

export async function PUT(request: Request) {
  try {
    const body = await parseJson(request, putSchema);
    if (!body.ok) return body.response;
    const result = writeWorkspaceFile({ path: body.data.path, content: body.data.content });
    return jsonOk({ file: result });
  } catch (error) {
    if (error instanceof WorkspaceError) return jsonError(error.message, 400);
    return errorResponse(error);
  }
}
