"use client";

import * as React from "react";
import { AlertCircle, Download, FileQuestion, Loader2, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/markdown/code-block";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { cn } from "@/lib/utils";

/**
 * The universal file previewer.
 *
 * Previewers are chosen by extension and MIME type, and anything heavy is only
 * imported when a file of that kind is actually opened: the spreadsheet and
 * Word parsers are dynamic imports, and a PDF is handed to the browser's own
 * viewer rather than shipping a second PDF engine. Text is read with a cap and
 * says so instead of freezing the tab on a 200 MB log.
 *
 * If a format cannot be rendered it falls back to honest metadata plus a
 * download, rather than an empty pane.
 */

export interface PreviewSource {
  /** Display name, used for the extension and the header. */
  name: string;
  /** Where to fetch the bytes, for anything read remotely. */
  url?: string;
  /** Bytes already in memory (a text file, an artifact body). */
  text?: string;
  mime?: string;
  bytes?: number;
  /** Open at this width rather than the default. */
  native?: boolean;
}

type Kind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "markdown"
  | "json"
  | "csv"
  | "sheet"
  | "docx"
  | "svg"
  | "html"
  | "code"
  | "text"
  | "unknown";

const TEXT_CAP = 600_000;
const LINE_CAP = 4_000;
const TABLE_ROW_CAP = 500;

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"];
const VIDEO_EXT = ["mp4", "webm", "ogv", "mov", "m4v"];
const AUDIO_EXT = ["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac"];
const SHEET_EXT = ["xlsx", "xls", "xlsm", "ods", "numbers"];
const CODE_EXT = [
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "css",
  "scss",
  "sass",
  "less",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "php",
  "sh",
  "bash",
  "ps1",
  "sql",
  "yml",
  "yaml",
  "toml",
  "ini",
  "env",
  "xml",
  "graphql",
  "vue",
  "svelte",
  "dockerfile",
  "makefile",
  "psql",
];

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function kindOf(name: string, mime?: string): Kind {
  const extension = extensionOf(name);
  const type = (mime ?? "").toLowerCase();

  if (type.startsWith("image/")) return extension === "svg" ? "svg" : "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf" || extension === "pdf") return "pdf";
  if (type.includes("wordprocessingml") || extension === "docx") return "docx";
  if (type.includes("spreadsheet") || type.includes("ms-excel") || SHEET_EXT.includes(extension))
    return "sheet";
  if (type === "text/csv" || extension === "csv" || extension === "tsv") return "csv";
  if (IMAGE_EXT.includes(extension)) return "image";
  if (VIDEO_EXT.includes(extension)) return "video";
  if (AUDIO_EXT.includes(extension)) return "audio";
  if (extension === "svg") return "svg";
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "md" || extension === "mdx" || extension === "markdown") return "markdown";
  if (extension === "json" || type === "application/json") return "json";
  if (CODE_EXT.includes(extension)) return "code";
  if (type.startsWith("text/")) return "text";
  return "unknown";
}

function languageForExtension(extension: string): string {
  const map: Record<string, string> = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "bash",
    bash: "bash",
    ps1: "powershell",
    sql: "sql",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    ini: "ini",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    md: "markdown",
    svg: "xml",
    graphql: "graphql",
    vue: "html",
    svelte: "html",
    dockerfile: "dockerfile",
  };
  return map[extension] ?? "text";
}

/** A small RFC 4180 reader: quoted fields, embedded newlines, escaped quotes. */
export function parseDelimited(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  while (index < input.length && rows.length <= TABLE_ROW_CAP) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function DataTable({ rows, delimiter }: { rows: string[][]; delimiter: string }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">No rows.</p>;
  const [header, ...body] = rows;
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-secondary">
          <tr>
            {header.map((cell, index) => (
              <th
                key={index}
                className="whitespace-nowrap border-b border-border px-2 py-1.5 font-medium"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-secondary/20">
              {header.map((_, cellIndex) => (
                <td
                  key={cellIndex}
                  className="max-w-[28ch] truncate border-b border-border/60 px-2 py-1 tabular-nums"
                >
                  {row[cellIndex] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > TABLE_ROW_CAP ? (
        <p className="px-2 py-1 text-[11px] text-muted-foreground">
          Showing the first {TABLE_ROW_CAP} rows of{" "}
          {delimiter === "\t" ? "this table" : "this file"}.
        </p>
      ) : null}
    </div>
  );
}

function SheetTable({ name, url }: { name: string; url: string }) {
  const [sheets, setSheets] = React.useState<Map<string, string[][]> | null>(null);
  const [active, setActive] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // sheetjs only loads when a spreadsheet is actually opened.
        const mod = await import("xlsx");
        const XLSX = (mod as unknown as { default?: typeof mod }).default ?? mod;
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const parsed = new Map<string, string[][]>();
        for (const sheetName of workbook.SheetNames.slice(0, 12)) {
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
            header: 1,
            blankrows: false,
            raw: false,
          });
          parsed.set(
            sheetName,
            rows
              .slice(0, TABLE_ROW_CAP + 1)
              .map((row) => (row ?? []).map((cell) => String(cell ?? "")))
          );
        }
        if (cancelled) return;
        setSheets(parsed);
        setActive(workbook.SheetNames[0] ?? "");
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not read this spreadsheet.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!sheets) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Reading {name}…
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {sheets.size > 1 ? (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Sheets">
          {[...sheets.keys()].map((sheetName) => (
            <Button
              key={sheetName}
              role="tab"
              aria-selected={sheetName === active}
              size="sm"
              variant={sheetName === active ? "secondary" : "ghost"}
              onClick={() => setActive(sheetName)}
            >
              {sheetName}
            </Button>
          ))}
        </div>
      ) : null}
      <DataTable rows={sheets.get(active) ?? []} delimiter="," />
    </div>
  );
}

function DocxPreview({ url }: { url: string }) {
  const [html, setHtml] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The browser build of mammoth, loaded only for .docx files. Its output is a
        // small tag set, but the document controls text, links and attributes, so the
        // result is treated as untrusted markup and only ever rendered in the iframe.
        const mod = await import("mammoth/mammoth.browser");
        const mammoth = ((mod as unknown as { default?: unknown }).default ?? mod) as {
          convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
        };
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (!cancelled) setHtml(result.value);
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not read this document.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (html === null) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Converting…
      </p>
    );
  }
  // Deliberate: an empty sandbox isolates untrusted DOCX-derived HTML (no scripts, no same-origin, no forms).
  return (
    <iframe
      sandbox=""
      srcDoc={html}
      title="Document preview"
      className="h-[70vh] w-full rounded-lg border border-border bg-white"
    />
  );
}

export function FilePreviewer({
  source,
  className,
}: {
  source: PreviewSource;
  className?: string;
}) {
  const kind = kindOf(source.name, source.mime);
  const extension = extensionOf(source.name);

  const needsText =
    source.text === undefined &&
    Boolean(source.url) &&
    ["markdown", "json", "csv", "code", "text", "html", "svg"].includes(kind);

  // Fetched text is keyed by URL, so switching files swaps stale state during
  // render instead of resetting it in an effect.
  const [loaded, setLoaded] = React.useState<{
    url: string;
    text: string;
    truncated: boolean;
  } | null>(null);
  const [failed, setFailed] = React.useState<{ url: string; message: string } | null>(null);

  const url = source.url;
  const text = source.text ?? (url && loaded?.url === url ? loaded.text : null);
  const truncated = url !== undefined && loaded?.url === url ? loaded.truncated : false;
  const error = url && failed?.url === url ? failed.message : null;
  const loading = Boolean(needsText && url && loaded?.url !== url && failed?.url !== url);

  React.useEffect(() => {
    if (!needsText || !url || loaded?.url === url || failed?.url === url) return;
    let cancelled = false;
    void (async () => {
      try {
        const arrayBuffer = await (await fetch(url)).arrayBuffer();
        const decoder = new TextDecoder("utf-8", { fatal: false });
        const decoded = decoder.decode(arrayBuffer.slice(0, TEXT_CAP));
        if (cancelled) return;
        setLoaded({ url, text: decoded, truncated: arrayBuffer.byteLength > TEXT_CAP });
      } catch (cause) {
        if (!cancelled)
          setFailed({
            url,
            message: cause instanceof Error ? cause.message : "Could not read this file.",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsText, url, loaded?.url, failed?.url]);

  const download = source.url ? (
    <Button variant="ghost" size="sm" asChild>
      <a href={source.url} download={source.name}>
        <Download className="size-3.5" />
        Download
      </a>
    </Button>
  ) : null;

  const header = (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="truncate font-mono">{source.name}</span>
      <span className="rounded-full border border-border px-1.5 uppercase">
        {extension || kind}
      </span>
      {source.bytes ? <span>{(source.bytes / 1024).toFixed(1)} kB</span> : null}
      <span className="ml-auto">{download}</span>
    </div>
  );

  const body = (() => {
    if (loading) {
      return (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </p>
      );
    }
    if (error) {
      return (
        <p className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="size-3.5" /> {error}
        </p>
      );
    }

    switch (kind) {
      case "image":
        return source.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary local/preview bytes, no loader or known dimensions
          <img
            src={source.url}
            alt={source.name}
            className="mx-auto max-h-full max-w-full rounded-lg border border-border object-contain"
          />
        ) : null;
      case "svg":
        return (
          <div className="flex flex-col gap-2">
            {source.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- same: previewing bytes, not a site asset
              <img
                src={source.url}
                alt={source.name}
                className="mx-auto max-h-80 rounded-lg border border-border bg-white p-2"
              />
            ) : null}
            {text ? <CodeBlock language="xml" code={text} /> : null}
          </div>
        );
      case "video":
        return source.url ? (
          <video
            src={source.url}
            controls
            className="mx-auto max-h-full max-w-full rounded-lg border border-border"
          >
            <track kind="captions" />
          </video>
        ) : null;
      case "audio":
        return (
          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <Music className="size-4 text-muted-foreground" />
            {source.url ? <audio src={source.url} controls className="w-full" /> : null}
          </div>
        );
      case "pdf":
        return source.url ? (
          <iframe
            title={source.name}
            src={source.url}
            className="h-full min-h-[28rem] w-full rounded-lg border border-border bg-white"
          />
        ) : null;
      case "sheet":
        return source.url ? <SheetTable name={source.name} url={source.url} /> : null;
      case "docx":
        return source.url ? <DocxPreview url={source.url} /> : null;
      case "markdown":
        return text !== null ? <MarkdownRenderer content={text} /> : null;
      case "json":
        return text !== null ? <CodeBlock language="json" code={safePrettyJson(text)} /> : null;
      case "csv":
        return text !== null ? (
          <DataTable
            rows={parseDelimited(text, extension === "tsv" ? "\t" : ",")}
            delimiter={extension === "tsv" ? "\t" : ","}
          />
        ) : null;
      case "html":
        return text !== null ? <CodeBlock language="html" code={text} /> : null;
      case "code":
        return text !== null ? (
          <CodeBlock language={languageForExtension(extension)} code={text} />
        ) : null;
      case "text":
        return text !== null ? (
          <pre className="overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/30 p-3 font-mono text-[11px] leading-relaxed">
            {limitLines(text)}
          </pre>
        ) : null;
      default:
        return (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <FileQuestion className="size-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              No preview for {extension ? `.${extension}` : "this"} files. The size and type are
              shown above; use Download to open it locally.
            </p>
          </div>
        );
    }
  })();

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}>
      {header}
      <div
        className={cn(
          "min-h-0 flex-1",
          kind === "pdf" || kind === "image" ? "overflow-hidden" : "overflow-auto"
        )}
      >
        {body}
      </div>
      {truncated ? (
        <p className="text-[11px] text-muted-foreground">
          Showing the first {(TEXT_CAP / 1000).toFixed(0)} kB. Download the file for all of it.
        </p>
      ) : null}
    </div>
  );
}

function limitLines(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= LINE_CAP) return text;
  return `${lines.slice(0, LINE_CAP).join("\n")}\n…[${lines.length - LINE_CAP} more lines]`;
}

function safePrettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
