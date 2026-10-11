import fs from "node:fs";
import path from "node:path";

/** Local attachment storage: bytes on disk, metadata in SQLite. */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_EXTRACTED_CHARS = 200_000;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 400;
export const MAX_ZIP_ENTRY_BYTES = 12 * 1024 * 1024;
export const MAX_ZIP_TOTAL_BYTES = 60 * 1024 * 1024;

export function uploadsDir(): string {
  // Container images point UPLOADS_DIR at the same volume as SQLITE_PATH so
  // attachment bytes and their metadata survive a restart. Local runs keep
  // using ./data/uploads.
  const configured = process.env.UPLOADS_DIR?.trim();
  if (configured) return path.resolve(process.cwd(), configured);
  return path.join(process.cwd(), "data", "uploads");
}

export function attachmentPath(id: string): string {
  return path.join(uploadsDir(), id);
}

export function writeAttachmentBytes(id: string, bytes: Buffer): string {
  const dir = uploadsDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = attachmentPath(id);
  fs.writeFileSync(target, bytes);
  return target;
}

export function readAttachmentBytes(id: string): Buffer {
  return fs.readFileSync(attachmentPath(id));
}

export function removeAttachmentBytes(id: string): void {
  try {
    fs.rmSync(attachmentPath(id), { force: true });
  } catch {
    /* the file may already be gone */
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}