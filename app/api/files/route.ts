import { jsonError, jsonOk, errorResponse } from "@/lib/server/api";
import { MAX_UPLOAD_BYTES, formatBytes } from "@/lib/files/storage";
import { mimeFromName } from "@/lib/files/extract";
import { storeAttachment, UnsupportedFileError } from "@/lib/files/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/files — upload one attachment as multipart/form-data.
 *
 * The file is extracted server-side (text, PDF, DOCX, XLSX, or an image data
 * URL) so the client can hand the model normalized content parts.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return jsonError("Attach a file under the `file` field.", 400);
    }
    if (file.size === 0) {
      return jsonError("That file is empty.", 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonError(`Attachments are limited to ${formatBytes(MAX_UPLOAD_BYTES)}.`, 413);
    }

    const name = file.name || "upload";
    const mime = file.type || mimeFromName(name);
    const bytes = Buffer.from(await file.arrayBuffer());

    const attachment = await storeAttachment({ name, mime, bytes });
    return jsonOk({ file: attachment }, 201);
  } catch (error) {
    if (error instanceof UnsupportedFileError) return jsonError(error.message, 415);
    return errorResponse(error);
  }
}