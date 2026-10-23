"use client";

import * as React from "react";
import {
  Archive,
  ExternalLink,
  Eye,
  FileCode2,
  Maximize2,
  Monitor,
  RotateCw,
  Save,
  Smartphone,
  Tablet,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CodeBlock } from "@/components/markdown/code-block";
import { api, type ArtifactDto } from "@/lib/api-client";
import { parseSiteBundle, summarizeSite, type SiteBundle } from "@/lib/sites/bundle";
import { cn } from "@/lib/utils";

/**
 * The multi-file site previewer.
 *
 * The bundle is served by `/api/artifacts/{id}/site/{path}` from a real URL, so
 * relative stylesheets, scripts, ES modules and page-to-page links all behave
 * the way they would on a host. The frame is sandboxed *without*
 * `allow-same-origin`, so the page runs on an opaque origin: it cannot read
 * Conduit's storage, cookies or DOM, and the CSP it is served with refuses every
 * outbound request. The runtime injected by the server posts console messages
 * and errors back here, which is how the console panel below works.
 */

const VIEWPORTS = [
  { id: "phone", label: "Phone", width: 390, Icon: Smartphone },
  { id: "tablet", label: "Tablet", width: 834, Icon: Tablet },
  { id: "laptop", label: "Laptop", width: 1280, Icon: Monitor },
  { id: "full", label: "Full", width: null, Icon: Maximize2 },
] as const;

type ViewportId = (typeof VIEWPORTS)[number]["id"];

interface ConsoleEntry {
  id: number;
  level: "error" | "warn" | "info";
  message: string;
}

function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    html: "html",
    htm: "html",
    css: "css",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    svg: "xml",
    xml: "xml",
    md: "markdown",
    txt: "text",
    webmanifest: "json",
  };
  return map[extension] ?? "text";
}

/** A stable, filesystem-safe name for the zip download. */
function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "site";
}

export function SitePreview({
  artifact,
  className,
  onRequestFix,
}: {
  artifact: ArtifactDto;
  className?: string;
  onRequestFix?: (message: string) => void;
}) {
  const bundle = React.useMemo<SiteBundle | null>(() => {
    try {
      return parseSiteBundle(artifact.content);
    } catch {
      return null;
    }
  }, [artifact.content]);

  const summary = React.useMemo(() => (bundle ? summarizeSite(bundle) : null), [bundle]);

  const [viewport, setViewport] = React.useState<ViewportId>("full");
  const [reloadKey, setReloadKey] = React.useState(0);
  const [showSource, setShowSource] = React.useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = React.useState(false);
  const [entries, setEntries] = React.useState<ConsoleEntry[]>([]);
  const [frameTitle, setFrameTitle] = React.useState<string | null>(null);
  const [zipping, setZipping] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const frameRef = React.useRef<HTMLIFrameElement>(null);

  // A new artifact version is a fresh site: reset to its entry page.
  const versionKey = `${artifact.id}:${artifact.version}`;
  const [pageState, setPageState] = React.useState<{ key: string; value: string }>({
    key: versionKey,
    value: bundle?.entry ?? "index.html",
  });
  if (pageState.key !== versionKey) {
    setPageState({ key: versionKey, value: bundle?.entry ?? "index.html" });
    setEntries([]);
    setConsoleOpen(false);
    setShowSource(null);
  }
  const activePage =
    pageState.key === versionKey ? pageState.value : (bundle?.entry ?? "index.html");
  const setActivePage = (next: string) => setPageState({ key: versionKey, value: next });

  // The runtime posts console output and errors from inside the sandbox.
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as { source?: string; kind?: string; payload?: unknown } | null;
      if (!data || data.source !== "conduit-preview") return;

      if (data.kind === "ready") {
        const payload = data.payload as { title?: string } | undefined;
        setFrameTitle(payload?.title ?? null);
        return;
      }
      if (data.kind === "error") {
        setEntries((current) =>
          [
            ...current,
            {
              id: current.length + 1,
              level: "error" as const,
              message: String(data.payload ?? ""),
            },
          ].slice(-100)
        );
        setConsoleOpen(true);
        return;
      }
      if (data.kind === "console") {
        const payload = data.payload as { level?: string; message?: string } | undefined;
        setEntries((current) =>
          [
            ...current,
            {
              id: current.length + 1,
              level: payload?.level === "warn" ? ("warn" as const) : ("info" as const),
              message: payload?.message ?? "",
            },
          ].slice(-100)
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const errorCount = entries.filter((entry) => entry.level === "error").length;

  const downloadZip = React.useCallback(async () => {
    if (!bundle) return;
    setZipping(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const file of bundle.files) zip.file(file.path, file.content);
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeName(artifact.identifier)}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setZipping(false);
    }
  }, [artifact.identifier, bundle]);

  const saveToWorkspace = React.useCallback(async () => {
    setSaving(true);
    try {
      const result = await api.exportArtifactToWorkspace(artifact.id);
      const count = result.written.length;
      toast.success(`Saved ${count} file${count === 1 ? "" : "s"} to ${result.target}`);
    } catch (cause) {
      // A 409 (the files are already there) carries the server's own message.
      toast.error(cause instanceof Error ? cause.message : "Could not save to the workspace.");
    } finally {
      setSaving(false);
    }
  }, [artifact.id]);

  if (!bundle || !summary) {
    return (
      <div
        className={cn(
          "rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs",
          className
        )}
      >
        <p className="flex items-center gap-1.5 font-medium text-destructive">
          <TriangleAlert className="size-3.5" /> This site bundle could not be parsed.
        </p>
        <p className="mt-1 text-muted-foreground">
          The artifact body has no readable files. Ask the model to republish it with{" "}
          <code className="rounded bg-secondary px-1">
            &lt;site-file path=&quot;index.html&quot;&gt;
          </code>{" "}
          blocks.
        </p>
      </div>
    );
  }

  const src = `/api/artifacts/${artifact.id}/site/${activePage.split("/").map(encodeURIComponent).join("/")}?v=${reloadKey}`;
  const width = VIEWPORTS.find((entry) => entry.id === viewport)?.width ?? null;

  const preview = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-0.5" role="group" aria-label="Preview width">
          {VIEWPORTS.map((entry) => (
            <Button
              key={entry.id}
              variant={viewport === entry.id ? "secondary" : "ghost"}
              size="icon-sm"
              aria-pressed={viewport === entry.id}
              aria-label={`${entry.label} width`}
              onClick={() => setViewport(entry.id)}
            >
              <entry.Icon className="size-3.5" />
            </Button>
          ))}
        </div>

        <span className="mx-1 h-4 w-px bg-border" />

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reload preview"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RotateCw className="size-3.5" />
        </Button>
        <Button
          variant={consoleOpen ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={consoleOpen}
          onClick={() => setConsoleOpen((open) => !open)}
        >
          <Terminal className="size-3.5" />
          Console
          {errorCount ? (
            <span className="ml-1 rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">
              {errorCount}
            </span>
          ) : null}
        </Button>

        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="ghost" size="sm" onClick={() => void saveToWorkspace()} disabled={saving}>
            <Save className="size-3.5" />
            {saving ? "Saving…" : "Save to workspace"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void downloadZip()} disabled={zipping}>
            <Archive className="size-3.5" />
            {zipping ? "Zipping…" : "Download"}
          </Button>
          <Button variant="ghost" size="icon-sm" asChild aria-label="Open preview in a new tab">
            <a href={src} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>

      {summary.pages.length > 1 ? (
        <div
          className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5"
          role="tablist"
          aria-label="Pages"
        >
          {summary.pages.map((path) => (
            <Button
              key={path}
              role="tab"
              aria-selected={path === activePage}
              variant={path === activePage ? "secondary" : "ghost"}
              size="sm"
              className="font-mono text-[11px]"
              onClick={() => setActivePage(path)}
            >
              {path}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden bg-secondary/30 p-2">
        <div
          className="mx-auto h-full overflow-hidden rounded-lg border border-border bg-background"
          style={width ? { width, maxWidth: "100%" } : undefined}
        >
          <iframe
            key={`${versionKey}:${src}`}
            ref={frameRef}
            title={frameTitle ?? artifact.title ?? artifact.identifier}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            src={src}
            className="h-full w-full bg-white"
          />
        </div>
      </div>
    </div>
  );

  const consolePanel = consoleOpen ? (
    <div
      className="flex max-h-40 shrink-0 flex-col border-t border-border bg-secondary/20"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
        <Terminal className="size-3" />
        Console
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto size-5"
          aria-label="Clear console"
          onClick={() => setEntries([])}
        >
          <X className="size-3" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {!entries.length ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            No messages. Errors and warnings appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className={cn(
                  "font-mono text-[11px] leading-relaxed",
                  entry.level === "error"
                    ? "text-destructive"
                    : entry.level === "warn"
                      ? "text-amber-600 dark:text-amber-500"
                      : "text-muted-foreground"
                )}
              >
                <span className="mr-1 uppercase opacity-60">{entry.level}</span>
                {entry.message}
              </li>
            ))}
          </ul>
        )}
      </div>
      {errorCount && onRequestFix ? (
        <div className="border-t border-border px-2 py-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onRequestFix(
                `The site "${artifact.title ?? artifact.identifier}" reported these errors in preview:\n\n` +
                  entries
                    .filter((entry) => entry.level === "error")
                    .map((entry) => `- ${entry.message}`)
                    .join("\n") +
                  `\n\nFix them and republish the whole site with the same <artifact identifier="${artifact.identifier}" type="site"> block, keeping every file.`
              )
            }
          >
            <TriangleAlert className="size-3.5" />
            Fix these errors
          </Button>
        </div>
      ) : null}
    </div>
  ) : null;

  const sourceOverlay = showSource ? (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-xs">
        <FileCode2 className="size-3.5 text-muted-foreground" />
        <span className="truncate font-mono">{showSource}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Close file"
          onClick={() => setShowSource(null)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <CodeBlock
          language={languageForPath(showSource)}
          code={bundle.files.find((file) => file.path === showSource)?.content ?? ""}
        />
      </div>
    </div>
  ) : null;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="rounded-full border border-border px-1.5 uppercase">site</span>
        <span>
          {summary.pages.length} page{summary.pages.length === 1 ? "" : "s"} · {bundle.files.length}{" "}
          file
          {bundle.files.length === 1 ? "" : "s"} · {(bundle.bytes / 1024).toFixed(1)} kB
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {bundle.files.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => setShowSource(file.path)}
              className={cn(
                "flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 font-mono transition-colors hover:bg-secondary",
                /\.html?$/i.test(file.path) && "text-foreground"
              )}
            >
              <Eye className="size-2.5" />
              {file.path}
            </button>
          ))}
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
        {preview}
        {consolePanel}
        {sourceOverlay}
      </div>
    </div>
  );
}

/** The fullscreen viewer, opened from the artifact panel. */
export function SitePreviewFullscreen({
  artifact,
  open,
  onOpenChange,
  onRequestFix,
}: {
  artifact: ArtifactDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestFix?: (message: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="max-w-[96vw] gap-0 p-0 sm:max-w-[96vw]">
        <DialogTitle className="sr-only">{artifact.title ?? artifact.identifier}</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span className="truncate font-medium text-foreground">
            {artifact.title ?? artifact.identifier}
          </span>
          <span className="rounded-full border border-border px-1.5 text-[10px] uppercase">
            site
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label="Exit fullscreen"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="h-[84vh] w-full p-3">
          <SitePreview artifact={artifact} onRequestFix={onRequestFix} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
