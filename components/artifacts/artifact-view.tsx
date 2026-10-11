"use client";

import * as React from "react";
import { CodeBlock } from "@/components/markdown/code-block";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { MermaidDiagram } from "@/components/markdown/mermaid-diagram";
import { useIsMounted } from "@/lib/hooks/use-mounted";
import type { ArtifactDto } from "@/lib/api-client";

/**
 * Renders one artifact version. HTML and SVG run inside a sandboxed iframe with
 * scripts allowed but no same-origin access, so generated markup cannot reach
 * Conduit's cookies, storage, or the parent DOM.
 */

function frameDocument(body: string, dark: boolean): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
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
  <body>${body}</body>
</html>`;
}

export function ArtifactView({ artifact }: { artifact: ArtifactDto }) {
  const mounted = useIsMounted();
  const dark = mounted && typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  if (artifact.type === "html" || artifact.type === "svg") {
    return (
      <iframe
        title={artifact.title ?? artifact.identifier}
        sandbox="allow-scripts allow-modals"
        srcDoc={frameDocument(artifact.content, dark)}
        className="h-full min-h-[18rem] w-full rounded-xl border border-border bg-white"
      />
    );
  }

  if (artifact.type === "mermaid") {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <MermaidDiagram chart={artifact.content} />
      </div>
    );
  }

  if (artifact.type === "markdown") {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-1">
        <MarkdownRenderer content={artifact.content} />
      </div>
    );
  }

  if (artifact.type === "react") {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <p className="mb-2 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          React artifacts are stored as source. Running JSX in the browser needs a compiler, which is
          planned; for a live preview, ask the model for an HTML artifact instead.
        </p>
        <CodeBlock language="tsx" code={artifact.content} />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <CodeBlock language="text" code={artifact.content} />
    </div>
  );
}