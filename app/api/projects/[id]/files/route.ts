import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { attachProjectFile, deleteProjectFile, listProjectFiles } from "@/lib/server/projects";
import { getAttachment } from "@/lib/files/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** Reuse a file already uploaded through /api/files (text is extracted). */
  attachmentId: z.string().min(1).optional(),
  /** Or index raw text directly. */
  name: z.string().trim().min(1).max(200).optional(),
  mimeType: z.string().max(120).nullable().optional(),
  text: z.string().min(1).max(2_000_000).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return jsonOk({ files: listProjectFiles(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/projects/:id/files -- attach a file and index it straight away. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  try {
    let name = parsed.data.name;
    let mimeType = parsed.data.mimeType ?? null;
    let size = parsed.data.text?.length ?? 0;
    let text = parsed.data.text ?? "";

    if (parsed.data.attachmentId) {
      const attachment = getAttachment(parsed.data.attachmentId);
      if (!attachment) return jsonError("That upload no longer exists.", 404);
      name = attachment.name;
      mimeType = attachment.mime;
      size = attachment.size;
      text = attachment.text ?? "";
      if (!text.trim()) {
        return jsonError(
          "Conduit could not read any text from that file, so it cannot be indexed. Upload a text-based document instead.",
          422
        );
      }
    }

    if (!name || !text.trim()) return jsonError("Provide an attachmentId or both name and text.", 400);

    const { file, embedded } = await attachProjectFile(id, { name, mimeType, size, text });
    return jsonOk({ file, embedded }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fileId = new URL(request.url).searchParams.get("fileId");
  if (!fileId) return jsonError("A fileId query parameter is required.", 400);
  try {
    const removed = deleteProjectFile(fileId);
    return removed ? jsonOk({ ok: true }) : jsonError("File not found.", 404);
  } catch (error) {
    return errorResponse(error);
  }
}