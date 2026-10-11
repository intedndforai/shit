import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { MAX_EXTRACTED_CHARS, MAX_IMAGE_BYTES } from "./storage";

/**
 * Server-side attachment extraction.
 *
 * Text-ish files are read as UTF-8, PDFs through pdfjs-dist, Word documents
 * through mammoth, and spreadsheets through SheetJS. Images are handed to the
 * model as data URLs so a vision-capable provider can see them. OCR and
 * office-format conversion are intentionally not faked; they are planned work.
 */

export const attachmentKinds = ["text", "image", "document", "spreadsheet", "pdf", "other"] as const;
export type AttachmentKind = (typeof attachmentKinds)[number];

export interface ExtractedFile {
  kind: AttachmentKind;
  text?: string;
  dataUrl?: string;
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
  if (extension === ".json") return "application/json";
  if (extension === ".md" || extension === ".markdown") return "text/markdown";
  if (TEXT_EXTENSIONS.includes(extension)) return "text/plain";
  return "application/octet-stream";
}

function clamp(text: string): { text: string; truncated: boolean } {
  const trimmed = text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  if (trimmed.length <= MAX_EXTRACTED_CHARS) return { text: trimmed, truncated: false };
  return {
    text: `${trimmed.slice(0, MAX_EXTRACTED_CHARS)}\n\n…[truncated by Conduit]`,
    truncated: true,
  };
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
  return { kind: "pdf", text, truncated: truncated || document.numPages > maxPages };
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
        .map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`)
        .join("\n")}`
    );
  }

  const { text, truncated: clipped } = clamp(blocks.join("\n\n"));
  return { kind: "spreadsheet", text, truncated: truncated || clipped };
}

export async function extractFile(input: { name: string; mime: string; bytes: Buffer }): Promise<ExtractedFile> {
  const mime = input.mime.toLowerCase();
  const name = input.name;

  if (IMAGE_MIMES.has(mime)) {
    if (input.bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new UnsupportedFileError("That image is larger than 8 MB. Resize it and try again.");
    }
    return {
      kind: "image",
      dataUrl: `data:${mime};base64,${input.bytes.toString("base64")}`,
      truncated: false,
    };
  }

  if (mime === "application/pdf" || extensionOf(name) === ".pdf") {
    return extractPdf(input.bytes);
  }

  const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (mime === docxMime || extensionOf(name) === ".docx") {
    return extractDocx(input.bytes);
  }
  if (mime === "application/msword" || extensionOf(name) === ".doc") {
    throw new UnsupportedFileError(
      "Legacy .doc files are not supported yet. Save the document as .docx or PDF and upload it again."
    );
  }

  if (SPREADSHEET_MIMES.has(mime) || [".xlsx", ".xls"].includes(extensionOf(name))) {
    return extractSpreadsheet(input.bytes);
  }

  if (isTextLike(mime, name)) {
    const { text, truncated } = clamp(input.bytes.toString("utf8"));
    const kind: AttachmentKind = extensionOf(name) === ".csv" || extensionOf(name) === ".tsv" ? "spreadsheet" : "text";
    return { kind, text, truncated };
  }

  throw new UnsupportedFileError(
    `Conduit cannot read ${mime || extensionOf(name) || "that file type"} yet. Supported: text/code, CSV, JSON, PDF, DOCX, XLSX, PNG, JPEG, WebP, GIF. OCR for scanned documents is planned.`
  );
}