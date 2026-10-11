import fs from "node:fs";
import { jsonError, errorResponse } from "@/lib/server/api";
import { getAttachment, getAttachmentPath } from "@/lib/files/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/files/{id} — stream the stored bytes (used for image previews). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const row = getAttachment(id);
    if (!row) return jsonError("Attachment not found.", 404);

    const path = getAttachmentPath(row);
    if (!fs.existsSync(path)) return jsonError("The stored file is missing.", 410);

    const bytes = fs.readFileSync(path);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": row.mime || "application/octet-stream",
        "content-length": String(bytes.byteLength),
        "cache-control": "private, max-age=3600",
        "content-disposition": `inline; filename="${row.name.replace(/"/g, "")}"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}