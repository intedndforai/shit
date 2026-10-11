import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { attachments, type Attachment } from "@/lib/db/schema";
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

export { UnsupportedFileError };