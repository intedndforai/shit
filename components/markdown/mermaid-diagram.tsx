"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Renders Mermaid diagrams. The library is imported lazily so it never lands in
 * the initial bundle, and failures are shown inline instead of breaking a chat.
 */
export function MermaidDiagram({ chart }: { chart: string }) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const render = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral",
        });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg: rendered } = await mermaid.render(id, chart);
        if (!cancelled) setSvg(rendered);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not render this diagram.");
        }
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="my-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0">
          <span className="block font-medium">Mermaid diagram failed to render</span>
          <span className="block break-words">{error}</span>
        </span>
      </div>
    );
  }

  if (!svg) return <Skeleton className="my-3 h-40 w-full rounded-xl" />;

  return (
    <div
      className="my-3 flex justify-center overflow-x-auto rounded-xl border border-border bg-card p-3"
      // Mermaid output is generated locally from user content; scripts stay disabled.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}