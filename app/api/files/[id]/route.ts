import fs from "node:fs";
import { jsonError, errorResponse } from "@/lib/server/api";
import { getAttachment, getAttachmentPath } from "@/lib/files/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The global header set in next.config.ts deliberately skips /api/* so it
 * cannot clobber this route's sandbox CSP, so nosniff is set per response.
 */
function withNosniff(response: Response): Response {
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

/** GET /api/files/{id} - stream the stored bytes (used for image previews). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const row = getAttachment(id);
    if (!row) return withNosniff(jsonError("Attachment not found.", 404));

    const path = getAttachmentPath(row);
    if (!fs.existsSync(path)) return withNosniff(jsonError("The stored file is missing.", 410));

    const bytes = fs.readFileSync(path);
    // Normalise the stored MIME: strip parameters (everything after the first ';'),
    // trim, and lowercase, so case/parameter variants cannot bypass the guard.
    const storedMime = row.mime || "application/octet-stream";
    const baseMime = storedMime.split(";")[0].trim().toLowerCase();
    const isDangerousInline =
      baseMime === "text/html" || baseMime === "application/xhtml+xml" || baseMime === "image/svg+xml";
    // Never serve HTML/XHTML as HTML on our origin; SVG is kept as image/svg+xml
    // (an <img> cannot execute it) but is always forced to download.
    const responseMime =
      baseMime === "text/html" || baseMime === "application/xhtml+xml"
        ? "text/plain; charset=utf-8"
        : baseMime;
    const headers: Record<string, string> = {
      "content-type": isDangerousInline ? responseMime : storedMime,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=3600",
      "content-disposition": isDangerousInline ? `attachment; filename="${row.name.replace(/"/g, "")}"` : `inline; filename="${row.name.replace(/"/g, "")}"`,
      "x-content-type-options": "nosniff",
    };
    if (isDangerousInline) {
      headers["content-security-policy"] = "sandbox";
    }
    return new Response(new Uint8Array(bytes), {
      headers,
    });
  } catch (error) {
    return withNosniff(errorResponse(error));
  }
}
