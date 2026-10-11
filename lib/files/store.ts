import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { attachments, type Attachment, type ContentPart } from "@/lib/db/schema";
import { attachmentPath, writeAttachmentBytes } from "./storage";
import { UnsupportedFileError, extractFile } from "./extract";

/** Attachment persistence: extract on upload, read back for the client. */

export interface AttachmentDto {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: Attachment["kind"];
  text?: string;
  dataUrl?: string;
  truncated: boolean;
  note?: string;
  url: string;
  createdAt: number;
}

export function toAttachmentDto(row: Attachment, dataUrl?: string): AttachmentDto {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    kind: row.kind,
    text: row.text ?? undefined,
    dataUrl,
    truncated: row.truncated,
    note: row.note ?? undefined,
    url: `/api/files/${row.id}`,
    createdAt: row.createdAt.getTime(),
  };
}

export function getAttachment(id: string): Attachment | undefined {
  return getDb().select().from(attachments).where(eq(attachments.id, id)).get();
}

export function getAttachmentPath(row: Attachment): string {
  return row.storagePath || attachmentPath(row.id);
}

export async function storeAttachment(input: {
  name: string;
  mime: string;
  bytes: Buffer;
}): Promise<AttachmentDto> {
  const extracted = await extractFile(input);
  const id = randomUUID();

  const created = getDb()
    .insert(attachments)
    .values({
      id,
      name: input.name,
      mime: input.mime,
      size: input.bytes.byteLength,
      kind: extracted.kind,
      storagePath: attachmentPath(id),
      text: extracted.text ?? null,
      truncated: extracted.truncated,
      note: extracted.note ?? null,
    })
    .returning()
    .get();

  try {
    writeAttachmentBytes(id, input.bytes);
  } catch (error) {
    getDb().delete(attachments).where(eq(attachments.id, id)).run();
    throw error;
  }

  return toAttachmentDto(created, extracted.dataUrl);
}

/**
 * Attach stored files to the message that carried them, so a chat's uploads can
 * be found (and later cleaned up) instead of drifting as orphaned rows.
 */
export function linkAttachments(chatId: string, messageId: string, parts: ContentPart[]): void {
  const ids = parts
    .map((part) =>
      part.kind === "image" || part.kind === "document" ? part.attachmentId : undefined
    )
    .filter((id): id is string => Boolean(id));
  if (!ids.length) return;

  const db = getDb();
  for (const id of ids) {
    db.update(attachments).set({ chatId, messageId }).where(eq(attachments.id, id)).run();
  }
}

export { UnsupportedFileError };