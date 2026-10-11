"use client";

import * as React from "react";
import { Check, ChevronRight, Loader2, TriangleAlert, Wrench } from "lucide-react";
import type { ContentPart } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

type ToolUsePart = Extract<ContentPart, { kind: "tool_use" }>;
type ToolResultPart = Extract<ContentPart, { kind: "tool_result" }>;

function humanise(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function summariseInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const entries = Object.entries(input as Record<string, unknown>);
  if (!entries.length) return "";
  return entries
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ")
    .slice(0, 160);
}

/** Collapsible cards for the tool calls a model made while answering. */
export function ToolCallList({ content }: { content: ContentPart[] }) {
  const calls = content.filter((part): part is ToolUsePart => part.kind === "tool_use");
  const results = new Map(
    content.filter((part): part is ToolResultPart => part.kind === "tool_result").map((part) => [part.id, part])
  );

  if (!calls.length) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {calls.map((call) => {
        const result = results.get(call.id);
        const status = call.status ?? (result ? (result.isError ? "error" : "success") : "running");

        return (
          <details
            key={call.id}
            className={cn(
              "group rounded-xl border bg-card/60 px-3 py-2 text-xs",
              status === "error" ? "border-destructive/40" : "border-border"
            )}
          >
            <summary className="flex cursor-pointer list-none items-center gap-2">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              {status === "running" ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : status === "error" ? (
                <TriangleAlert className="size-3.5 shrink-0 text-destructive" />
              ) : (
                <Check className="size-3.5 shrink-0 text-accent" />
              )}
              <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">{humanise(call.name)}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{summariseInput(call.input)}</span>
            </summary>

            <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
              <div>
                <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Input</p>
                <pre className="max-h-40 overflow-auto rounded-lg bg-secondary/50 p-2 text-[11px]">
                  {JSON.stringify(call.input ?? {}, null, 2)}
                </pre>
              </div>
              {result ? (
                <div>
                  <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {result.isError ? "Error" : "Result"}
                  </p>
                  <pre
                    className={cn(
                      "max-h-56 overflow-auto rounded-lg p-2 text-[11px]",
                      result.isError ? "bg-destructive/10 text-destructive" : "bg-secondary/50"
                    )}
                  >
                    {result.output}
                  </pre>
                </div>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** "Sources" list built from the citations a tool reported. */
export function CitationList({ citations }: { citations: { title: string; url: string }[] }) {
  const unique = React.useMemo(() => {
    const seen = new Set<string>();
    return citations.filter((citation) => {
      if (!citation.url || seen.has(citation.url)) return false;
      seen.add(citation.url);
      return true;
    });
  }, [citations]);

  if (!unique.length) return null;

  return (
    <div className="rounded-xl border border-border bg-card/50 px-3 py-2">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Sources</p>
      <ol className="flex flex-col gap-0.5 text-xs">
        {unique.slice(0, 8).map((citation, index) => (
          <li key={citation.url} className="flex gap-1.5">
            <span className="text-muted-foreground">{index + 1}.</span>
            <a
              href={citation.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-accent hover:underline"
              title={citation.url}
            >
              {citation.title || citation.url}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}