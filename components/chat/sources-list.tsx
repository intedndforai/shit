"use client";

import * as React from "react";
import { BookOpen, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Project knowledge-base excerpts that were handed to the model for this answer.
 * Collapsed by default so long transcripts stay scannable.
 */
export function SourceList({
  sources,
  mode,
}: {
  sources: Array<{ title: string; snippet: string }>;
  mode?: "embeddings" | "keywords" | "none";
}) {
  const [open, setOpen] = React.useState(false);
  if (!sources.length) return null;
  const modeLabel = mode === "embeddings" ? "vector search" : mode === "keywords" ? "keyword search" : null;

  return (
    <div className="rounded-xl border border-border bg-secondary/30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
      >
        <BookOpen className="size-3.5" />
        <span>
          {sources.length} knowledge-base excerpt{sources.length === 1 ? "" : "s"}
          {modeLabel ? <span className="ml-1 opacity-80">· {modeLabel}</span> : null}
        </span>
        <ChevronRight className={cn("ml-auto size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <ul className="flex flex-col gap-2 border-t border-border px-3 py-2">
          {sources.map((source, index) => (
            <li key={`${source.title}-${index}`} className="text-xs">
              <p className="font-medium">
                [{index + 1}] {source.title}
              </p>
              <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-muted-foreground">
                {source.snippet}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}