"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Code2, Eye, Maximize2, TriangleAlert, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CodeBlock } from "@/components/markdown/code-block";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { MermaidDiagram } from "@/components/markdown/mermaid-diagram";
import { useIsMounted } from "@/lib/hooks/use-mounted";
import { cn } from "@/lib/utils";
import type { ArtifactDto } from "@/lib/api-client";

/** Types that have a live preview. React stays code-only (see below). */
const PREVIEWABLE = new Set<ArtifactDto["type"]>(["html", "svg", "mermaid", "markdown"]);

function languageFor(type: ArtifactDto["type"]): string {
  switch (type) {
    case "react":
      return "tsx";
    case "html":
      return "html";
    case "svg":
      return "xml";
    case "mermaid":
      return "mermaid";
    case "markdown":
      return "markdown";
    default:
      return "text";
  }
}

/**
 * The sandboxed preview document. Generated markup is untrusted: scripts may
 * run, but a restrictive CSP blocks network, frame, form, and navigation
 * requests, and the iframe's `sandbox` keeps it on an opaque origin with no
 * access to Conduit's cookies, storage, or DOM.
 */
export function frameDocument(body: string, dark: boolean): string {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "media-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ].join("; ");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        padding: 16px;
        background: ${dark ? "#131313" : "#ffffff"};
        color: ${dark ? "#ededed" : "#111111"};
      }
    </style>
  </head>
  <body>
${body}
    <script>
      // Preview failures are reported to the parent, which shows them with an
      // explicit "Fix this error" action. Nothing is sent to a model on its own.
      (function () {
        function report(payload) {
          try {
            parent.postMessage(
              { source: "conduit-artifact", kind: "error", payload: String(payload).slice(0, 400) },
              "*"
            );
          } catch (error) {
            /* nothing else we can do inside the sandbox */
          }
        }
        window.addEventListener("error", function (event) {
          report((event && event.message) || "Script error");
        });
        window.addEventListener("unhandledrejection", function (event) {
          var reason = event && event.reason;
          report("Unhandled rejection: " + ((reason && reason.message) || reason || ""));
        });
      })();
    </script>
  </body>
</html>`;
}

/**
 * One isolated preview frame. Messages are accepted only when they come from
 * this exact frame and carry the expected shape, so a nested frame or another
 * page cannot spoof an error.
 */
function ArtifactFrame({
  artifact,
  dark,
  className,
  onError,
}: {
  artifact: ArtifactDto;
  dark: boolean;
  className?: string;
  onError: (message: string) => void;
}) {
  const ref = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = ref.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as { source?: string; kind?: string; payload?: unknown } | null;
      if (!data || data.source !== "conduit-artifact" || data.kind !== "error") return;
      onError(String(data.payload ?? "The preview reported an error."));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onError]);

  return (
    <iframe
      ref={ref}
      title={artifact.title ?? artifact.identifier}
      sandbox="allow-scripts allow-modals"
      srcDoc={frameDocument(artifact.content, dark)}
      className={cn("h-full min-h-[18rem] w-full rounded-xl border border-border bg-white", className)}
    />
  );
}

/**
 * Renders one artifact version with Preview/Code tabs, a fullscreen viewer, and
 * a sandboxed runtime. Preview errors are surfaced locally; the model is only
 * involved when the user presses "Fix this error".
 */
export function ArtifactView({
  artifact,
  onRequestFix,
  className,
}: {
  artifact: ArtifactDto;
  onRequestFix?: (message: string) => void;
  className?: string;
}) {
  const mounted = useIsMounted();
  const { resolvedTheme } = useTheme();
  const dark = mounted && (resolvedTheme === "dark" || resolvedTheme === "contrast");
  const canPreview = PREVIEWABLE.has(artifact.type);

  const [fullscreen, setFullscreen] = React.useState(false);

  // Each stored version is a fresh document. Rather than resetting state in an
  // effect (which would cascade renders), the key below marks stale state and
  // the render pass swaps it out before anything is shown.
  const versionKey = `${artifact.id}:${artifact.version}`;
  const defaultTab: "preview" | "code" = canPreview ? "preview" : "code";
  const [tabState, setTabState] = React.useState<{ key: string; value: "preview" | "code" }>({
    key: versionKey,
    value: defaultTab,
  });
  const [errorState, setErrorState] = React.useState<{ key: string; value: string | null }>({
    key: versionKey,
    value: null,
  });
  if (tabState.key !== versionKey) setTabState({ key: versionKey, value: defaultTab });
  if (errorState.key !== versionKey) setErrorState({ key: versionKey, value: null });

  const tab = tabState.key === versionKey ? tabState.value : defaultTab;
  const runtimeError = errorState.key === versionKey ? errorState.value : null;
  const setTab = (value: "preview" | "code") => setTabState({ key: versionKey, value });
  const setRuntimeError = (value: string | null) => setErrorState({ key: versionKey, value });

  const code = <CodeBlock language={languageFor(artifact.type)} code={artifact.content} />;

  const preview = canPreview ? (
    artifact.type === "mermaid" ? (
      <div className="min-h-0 flex-1 overflow-auto">
        <MermaidDiagram chart={artifact.content} />
      </div>
    ) : artifact.type === "markdown" ? (
      <div className="min-h-0 flex-1 overflow-auto px-1">
        <MarkdownRenderer content={artifact.content} />
      </div>
    ) : (
      <ArtifactFrame artifact={artifact} dark={dark} onError={setRuntimeError} />
    )
  ) : null;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="mb-2 flex items-center gap-1">
        {canPreview ? (
          <>
            <Button
              variant={tab === "preview" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={tab === "preview"}
              onClick={() => setTab("preview")}
            >
              <Eye className="size-3.5" />
              Preview
            </Button>
            <Button
              variant={tab === "code" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={tab === "code"}
              onClick={() => setTab("code")}
            >
              <Code2 className="size-3.5" />
              Code
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setFullscreen(true)}
              aria-label="Open preview fullscreen"
            >
              <Maximize2 className="size-3.5" />
              Fullscreen
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">{artifact.type} artifact</span>
        )}
      </div>

      {runtimeError ? (
        <div className="mb-2 flex flex-wrap items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{runtimeError}</span>
          {onRequestFix ? (
            <Button size="sm" variant="outline" onClick={() => onRequestFix(runtimeError)}>
              <Wand2 className="size-3.5" />
              Fix this error
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setRuntimeError(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {artifact.type === "react" ? (
          <>
            <p className="mb-2 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
              React artifacts are stored as source. Conduit does not bundle a JSX compiler, and it will not
              pretend to run one: ask the model for a self-contained HTML artifact if you want a live preview.
            </p>
            {code}
          </>
        ) : tab === "code" || !canPreview ? (
          code
        ) : (
          preview
        )}
      </div>

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent hideClose className="max-w-[96vw] gap-0 p-0 sm:max-w-[96vw]">
          <DialogTitle className="sr-only">{artifact.title ?? artifact.identifier}</DialogTitle>
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
            <span className="truncate font-medium text-foreground">{artifact.title ?? artifact.identifier}</span>
            <span className="rounded-full border border-border px-1.5 text-[10px] uppercase">{artifact.type}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label="Exit fullscreen"
              onClick={() => setFullscreen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="h-[80vh] w-full overflow-auto p-3">
            {canPreview && tab === "preview" ? (
              artifact.type === "mermaid" ? (
                <MermaidDiagram chart={artifact.content} />
              ) : artifact.type === "markdown" ? (
                <MarkdownRenderer content={artifact.content} />
              ) : (
                <ArtifactFrame artifact={artifact} dark={dark} onError={setRuntimeError} />
              )
            ) : (
              code
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
