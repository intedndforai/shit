import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { MAX_EXTRACTED_CHARS, MAX_IMAGE_BYTES, MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES, MAX_ZIP_TOTAL_BYTES , formatBytes } from "./storage";

/**
 * Server-side attachment extraction.
 *
 * Text-ish files are read as UTF-8, PDFs through pdfjs-dist, Word documents
 * through mammoth, and spreadsheets through SheetJS. Images are handed to the
 * model as data URLs so a vision-capable provider can see them. OCR and
 * office-format conversion are intentionally not faked; they are planned work.
 */

export const attachmentKinds = ["text", "image", "document", "spreadsheet", "pdf", "other", "binary"] as const;
export type AttachmentKind = (typeof attachmentKinds)[number];

export interface ExtractedFile {
  kind: AttachmentKind;
  text?: string;
  dataUrl?: string;
  note?: string;
  truncated: boolean;
}

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFileError";
  }
}

const TEXT_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/sql",
]);

const TEXT_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".log", ".yaml", ".yml",
  ".xml", ".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".py",
  ".sql", ".sh", ".env", ".ini", ".toml",
];

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

/** Media containers are accepted as opaque binaries: stored and streamed, never text-extracted. */
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a", ".flac"];
const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov"];

const SPREADSHEET_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

export function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index).toLowerCase();
}

export function mimeFromName(name: string): string {
  const extension = extensionOf(name);
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === ".doc") return "application/msword";
  if (extension === ".xlsx") return SPREADSHEET_MIMES.values().next().value ?? "application/octet-stream";
  if (extension === ".xls") return "application/vnd.ms-excel";
  if (extension === ".csv") return "text/csv";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".ogg") return "audio/ogg";
  if (extension === ".m4a") return "audio/mp4";
  if (extension === ".flac") return "audio/flac";
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".json") return "application/json";
  if (extension === ".md" || extension === ".markdown") return "text/markdown";
  if (TEXT_EXTENSIONS.includes(extension)) return "text/plain";
  return "application/octet-stream";
}

/**
 * Magic-byte signatures. Extension and MIME claims are checked against the
 * actual bytes so a renamed file is caught instead of producing a confusing
 * parse error.
 */
function detectedSignatureKind(bytes: Buffer): "pdf" | "zip" | "png" | "jpeg" | "gif" | "webp" | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) return "zip";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  return null;
}


function clamp(text: string): { text: string; truncated: boolean } {
  const trimmed = text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  if (trimmed.length <= MAX_EXTRACTED_CHARS) return { text: trimmed, truncated: false };
  return {
    text: `${trimmed.slice(0, MAX_EXTRACTED_CHARS)}\n\n…[truncated by Conduit]`,
    truncated: true,
  };
}

/**
 * Spreadsheet formula neutralisation: a cell beginning with =, +, -, @, tab or
 * CR is re-read as a formula (DDE / hyperlink exfiltration) when the extracted
 * text is pasted into Excel or Sheets, so it gets a leading single quote - the
 * spreadsheet convention that forces a literal string. Extracted TEXT only;
 * stored bytes are never rewritten.
 */
const FORMULA_STARTS = ["=", "+", "-", "@", "\t", "\r"];

function neutraliseCell(value: string): string {
  return value.length > 0 && FORMULA_STARTS.includes(value[0]) ? "'" + value : value;
}

/**
 * Cell-to-text pass for delimited text (CSV/TSV): walks the buffer field by
 * field so quoted cells are handled, neutralising each cell value while the
 * original quoting, delimiters and line breaks stay intact.
 */
function neutraliseDelimitedCells(text: string, delimiter: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const quoted = text[i] === '"';
    let value = "";
    if (quoted) {
      i += 1;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += text[i];
        i += 1;
      }
      out += '"' + neutraliseCell(value).replace(/"/g, '""') + '"';
    } else {
      while (i < text.length && text[i] !== delimiter && text[i] !== "\n" && text[i] !== "\r") {
        value += text[i];
        i += 1;
      }
      out += neutraliseCell(value);
    }
    if (i < text.length && (text[i] === delimiter || text[i] === "\n" || text[i] === "\r")) {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

function isTextLike(mime: string, name: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (TEXT_MIMES.has(mime)) return true;
  return TEXT_EXTENSIONS.includes(extensionOf(name));
}

interface PdfTextItem {
  str?: string;
}
interface PdfPage {
  getTextContent: () => Promise<{ items: PdfTextItem[] }>;
}
interface PdfDocument {
  numPages: number;
  getPage: (page: number) => Promise<PdfPage>;
}
interface PdfModule {
  getDocument: (options: Record<string, unknown>) => { promise: Promise<PdfDocument> };
  GlobalWorkerOptions?: { workerSrc: string };
}

/**
 * Resolve the pdfjs worker file so it can run inside a Node route handler.
 *
 * Bundlers rewrite `require.resolve` into a project-relative placeholder, so the
 * file is located on disk first and converted to a file:// URL.
 */
const nodeRequire = createRequire(import.meta.url);

function resolvePdfWorker(): string {
  const candidates = [
    path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
    path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return pathToFileURL(candidate).href;
  }

  try {
    const resolved = nodeRequire.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    if (fs.existsSync(resolved)) return pathToFileURL(resolved).href;
  } catch {
    /* fall through: pdfjs will try its own fake worker */
  }

  return "";
}

async function extractPdf(bytes: Buffer): Promise<ExtractedFile> {
  // Loaded through createRequire so Next/Turbopack treat pdfjs as a runtime
  // dependency (see serverExternalPackages) instead of rewriting its worker
  // import into a bundle path that does not exist at runtime.
  const pdfjs = nodeRequire("pdfjs-dist/legacy/build/pdf.mjs") as unknown as PdfModule;

  // Running inside a serverless-ish route handler means there is no worker file
  // to spawn by default; point pdfjs at the worker on disk (or disable it).
  const workerSrc = resolvePdfWorker();
  if (workerSrc && pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    disableWorker: !workerSrc,
  }).promise;

  const pages: string[] = [];
  const maxPages = Math.min(document.numPages, 120);
  for (let page = 1; page <= maxPages; page += 1) {
    const content = await (await document.getPage(page)).getTextContent();
    pages.push(content.items.map((item) => item.str ?? "").join(" ").replace(/[ \t]+/g, " ").trim());
  }

  const body = pages.join("\n\n");
  const { text, truncated } = clamp(body);
  const clipped = truncated || document.numPages > maxPages;
  const emptyPages = pages.filter((page) => !page.trim()).length;

  if (!text) {
    return {
      kind: "pdf",
      text: "",
      truncated: false,
      note: "This PDF has no selectable text — likely scanned or image-only pages. OCR is not bundled, so upload a text-based PDF or DOCX instead.",
    };
  }

  const notes: string[] = [];
  if (emptyPages) {
    notes.push(
      emptyPages + " of " + maxPages + " page" + (maxPages === 1 ? "" : "s") + " had no selectable text (scanned or image-only)."
    );
  }
  if (document.numPages > maxPages) {
    notes.push("Only the first " + maxPages + " of " + document.numPages + " pages were read.");
  } else if (truncated) {
    notes.push("The extracted text was trimmed to fit the character limit.");
  }

  return { kind: "pdf", text, truncated: clipped, ...(notes.length ? { note: notes.join(" ") } : {}) };
}

interface MammothModule {
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
}

async function extractDocx(bytes: Buffer): Promise<ExtractedFile> {
  const mammoth = (await import("mammoth")) as unknown as MammothModule;
  const { value } = await mammoth.extractRawText({ buffer: bytes });
  const { text, truncated } = clamp(value);
  return { kind: "document", text, truncated };
}

interface SheetJsModule {
  read: (data: Buffer, options: { type: "buffer" }) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json: (sheet: unknown, options: { header: 1; blankrows: false }) => unknown[][];
  };
}

async function extractSpreadsheet(bytes: Buffer): Promise<ExtractedFile> {
  const XLSX = (await import("xlsx")) as unknown as SheetJsModule;
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const blocks: string[] = [];
  let truncated = false;

  for (const name of workbook.SheetNames.slice(0, 12)) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false });
    const limited = rows.slice(0, 400).map((row) => row.slice(0, 40));
    if (rows.length > limited.length) truncated = true;
    blocks.push(
      `### ${name}\n\n${limited
        .map(
          (row) =>
            `| ${row.map((cell) => neutraliseCell(String(cell ?? "")).replace(/\|/g, "\\|")).join(" | ")} |`
        )
        .join("\n")}`
    );
  }

  const { text, truncated: clipped } = clamp(blocks.join("\n\n"));
  return { kind: "spreadsheet", text, truncated: truncated || clipped };
}

interface ZipEntry {
  name: string;
  dir: boolean;
  async(type: "string"): Promise<string>;
  async(type: "nodebuffer"): Promise<Buffer>;
}
interface ZipArchive { files: Record<string, ZipEntry>; }

/**
 * ZIP extraction with archive safety: capped entry count, per-file and total
 * uncompressed size limits, and rejection of traversal paths ("..", absolute
 * paths, drive letters). Entries are read as text when possible; PDFs, DOCX,
 * XLSX, and CSV inside the archive go through the normal extractors. Images
 * and unknown files are skipped and reported, not silently dropped.
 */
async function extractZip(bytes: Buffer): Promise<ExtractedFile> {
  const JSZip = nodeRequire("jszip") as { loadAsync: (data: Buffer) => Promise<ZipArchive> };
  let zip: ZipArchive;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new UnsupportedFileError("That ZIP archive could not be read.");
  }
  const entries = Object.values(zip.files);
  if (!entries.length) throw new UnsupportedFileError("That archive is empty.");
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new UnsupportedFileError("That archive has " + entries.length + " entries; Conduit accepts up to " + MAX_ZIP_ENTRIES + ".");
  }

  const safeName = (raw: string): string => raw.replace(/\\/g, "/").replace(/^\.\//, "");
  let total = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    const norm = safeName(entry.name);
    if (norm.startsWith("/") || /^[a-zA-Z]:\//.test(norm) || norm.split("/").includes("..")) {
      throw new UnsupportedFileError("That archive contains an unsafe path (\"" + entry.name + "\") and was rejected.");
    }
    const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    if (declared > MAX_ZIP_ENTRY_BYTES) {
      throw new UnsupportedFileError("One file inside the archive is larger than the " + formatBytes(MAX_ZIP_ENTRY_BYTES) + " per-file limit.");
    }
    total += declared;
    if (total > MAX_ZIP_TOTAL_BYTES) {
      throw new UnsupportedFileError("Extracted archive content is larger than " + formatBytes(MAX_ZIP_TOTAL_BYTES) + ".");
    }
  }

  const parts: string[] = [];
  const skippedNames: string[] = [];
  let truncated = false;
  /** Re-checked against the real inflated bytes, in case a header lies. */
  let actualTotal = 0;

  for (const entry of entries) {
    if (entry.dir) continue;
    const norm = safeName(entry.name);
    const ext = extensionOf(entry.name);
    if ([ ".png", ".jpg", ".jpeg", ".gif", ".webp" ].includes(ext)) {
      skippedNames.push(entry.name);
      continue;
    }

    const binaryEntry = [".pdf", ".docx", ".xlsx", ".xls", ".csv", ".tsv", ".doc"].includes(ext);
    if (!binaryEntry && !isTextLike(mimeFromName(entry.name), entry.name)) {
      skippedNames.push(entry.name);
      continue;
    }

    let raw: Buffer;
    try {
      raw = await entry.async("nodebuffer");
    } catch {
      skippedNames.push(entry.name);
      continue;
    }

    // Decompression-bomb guard: the central directory can understate a size,
    // so the inflated length is checked too, and a breach rejects the archive.
    if (raw.byteLength > MAX_ZIP_ENTRY_BYTES) {
      throw new UnsupportedFileError(
        "One file inside the archive expanded past the " + formatBytes(MAX_ZIP_ENTRY_BYTES) + " per-file limit."
      );
    }
    actualTotal += raw.byteLength;
    if (actualTotal > MAX_ZIP_TOTAL_BYTES) {
      throw new UnsupportedFileError("Extracted archive content is larger than " + formatBytes(MAX_ZIP_TOTAL_BYTES) + ".");
    }

    let textNode: string | null = null;
    let entryTruncated = false;
    if (binaryEntry) {
      try {
        const extracted = await extractFile({ name: entry.name, mime: mimeFromName(entry.name), bytes: raw });
        textNode = extracted.text ?? null;
        entryTruncated = extracted.truncated;
      } catch (error) {
        if (error instanceof UnsupportedFileError) {
          skippedNames.push(entry.name);
          continue;
        }
        throw error;
      }
    } else {
      const clamped = clamp(raw.toString("utf8").slice(0, 100_000));
      textNode = clamped.text;
      entryTruncated = clamped.truncated;
    }

    if (textNode?.trim()) parts.push("# " + norm + "\n" + textNode.trim());
    if (entryTruncated) truncated = true;
  }

  if (!parts.length) {
    throw new UnsupportedFileError("That archive contains no files Conduit can read (text, code, CSV, PDF, DOCX, or XLSX).");
  }
  const { text, truncated: clipped } = clamp(parts.join("\n\n"));
  const note = skippedNames.length
    ? parts.length + " file" + (parts.length === 1 ? "" : "s") + " extracted; " + skippedNames.length + " skipped (" + skippedNames.slice(0, 3).join(", ") + (skippedNames.length > 3 ? ", …" : "") + ")"
    : undefined;
  return { kind: "other", text, truncated: truncated || clipped, note };
}

export async function extractFile(input: { name: string; mime: string; bytes: Buffer }): Promise<ExtractedFile> {
  const mime = input.mime.toLowerCase();
  const name = input.name;
  const ext = extensionOf(name);
  const signature = detectedSignatureKind(input.bytes);

  /* Signature consistency: a renamed file is rejected instead of misparsed. */
  const expectedSignature: Record<string, string> = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  if (expectedSignature[mime]) {
    const wanted = expectedSignature[mime] as string;
    if (signature !== wanted && signature !== null) {
      throw new UnsupportedFileError("That file claims to be " + mime + " but its bytes look like " + signature.toUpperCase() + ", not " + wanted.toUpperCase() + ".");
    }
  }
  if (ext === ".pdf" && mime !== "application/pdf" && signature === "pdf") {
    /* PDF detected by bytes even when the MIME tag is generic */
  }

  if (IMAGE_MIMES.has(mime)) {
    if (input.bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new UnsupportedFileError("That image is larger than 8 MB. Resize it and try again.");
    }
    return {
      kind: "image",
      dataUrl: "data:" + mime + ";base64," + input.bytes.toString("base64"),
      truncated: false,
    };
  }

  if (mime === "application/pdf" || ext === ".pdf") {
    if (signature !== "pdf") {
      throw new UnsupportedFileError("That file is named as a PDF but does not start with a PDF signature — is it really a PDF?");
    }
    return extractPdf(input.bytes);
  }

  const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (mime === docxMime || ext === ".docx") {
    if (signature !== "zip") {
      throw new UnsupportedFileError("A .docx file must be a ZIP container; these bytes do not look like one.");
    }
    return extractDocx(input.bytes);
  }
  if (mime === "application/msword" || ext === ".doc") {
    throw new UnsupportedFileError(
      "Legacy .doc files are not supported yet. Save the document as .docx or PDF and upload it again."
    );
  }

  if (SPREADSHEET_MIMES.has(mime) || [".xlsx", ".xls"].includes(ext)) {
    if (signature !== "zip") {
      throw new UnsupportedFileError("A .xlsx/.xls file must be a ZIP container; these bytes do not look like one.");
    }
    return extractSpreadsheet(input.bytes);
  }

  if (mime === "application/zip" || ext === ".zip" || (signature === "zip" && ext !== ".docx" && ext !== ".xlsx")) {
    return extractZip(input.bytes);
  }

  if (
    mime.startsWith("audio/") ||
    mime.startsWith("video/") ||
    AUDIO_EXTENSIONS.includes(ext) ||
    VIDEO_EXTENSIONS.includes(ext)
  ) {
    // Media is stored as-is and streamed back; no text extraction is attempted.
    return { kind: "binary", truncated: false };
  }

  if (isTextLike(mime, name)) {
    if (input.bytes.includes(0)) {
      throw new UnsupportedFileError("That file looks binary rather than text. ZIP and office formats are extracted from their own containers.");
    }
    const raw = input.bytes.toString("utf8");
    const delimited = [".csv", ".tsv"].includes(ext) || mime === "text/csv" || mime === "text/tab-separated-values";
    const delimiter = ext === ".tsv" || mime === "text/tab-separated-values" ? "\t" : ",";
    const { text, truncated } = clamp(delimited ? neutraliseDelimitedCells(raw, delimiter) : raw);
    const kind: AttachmentKind = ext === ".csv" || ext === ".tsv" ? "spreadsheet" : "text";
    return { kind, text, truncated };
  }

  throw new UnsupportedFileError(
    "Conduit cannot read " + (mime || ext || "that file type") + " yet. Supported: text/code, CSV, JSON, PDF, DOCX, XLSX, PNG, JPEG, WebP, GIF, audio/video, and ZIP archives. OCR for scanned documents isn't bundled."
  );
}