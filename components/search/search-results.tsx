"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, MessageSquare, Search as SearchIcon } from "lucide-react";
import type { SearchHit } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

/** Highlight the matched term inside a snippet. */
export function HighlightedSnippet({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;

  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return <>{text}</>;

  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-accent/25 px-0.5 text-foreground">{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  );
}

/** Result rows shared by the command dialog and the /search page. */
export function SearchResults({
  hits,
  query,
  loading,
  error,
  activeIndex = -1,
  onHover,
  onSelect,
}: {
  hits: SearchHit[];
  query: string;
  loading: boolean;
  error: string | null;
  activeIndex?: number;
  onHover?: (index: number) => void;
  onSelect?: () => void;
}) {
  if (error) {
    return <p className="px-3 py-6 text-center text-sm text-destructive">{error}</p>;
  }

  if (!loading && query.trim().length >= 2 && !hits.length) {
    return <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matches for “{query.trim()}”.</p>;
  }

  if (!hits.length) return null;

  return (
    <ul className="flex flex-col gap-0.5 p-1">
      {hits.map((hit, index) => (
        <li key={`${hit.chatId}-${hit.messageId ?? "title"}`}>
          <Link
            href={`/chat/${hit.chatId}`}
            onClick={onSelect}
            onMouseEnter={() => onHover?.(index)}
            className={cn(
              "flex flex-col gap-0.5 rounded-lg px-2.5 py-2 transition-colors",
              index === activeIndex ? "bg-secondary" : "hover:bg-secondary/70"
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{hit.chatTitle ?? "Untitled chat"}</span>
              {hit.role ? (
                <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {hit.role}
                </span>
              ) : null}
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {formatRelativeTime(hit.updatedAt)}
              </span>
            </span>
            <span className="line-clamp-2 pl-5 text-xs text-muted-foreground">
              <HighlightedSnippet text={hit.snippet} query={query} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SearchEmptyHint({ hasModels }: { hasModels?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
      <SearchIcon className="size-4 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Search titles and message text.</p>
      <p className="text-xs text-muted-foreground">
        {hasModels === false ? "Start a chat first, then search it here." : "Type at least two characters."}
      </p>
    </div>
  );
}

export function SearchSpinner() {
  return (
    <span className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      Searching…
    </span>
  );
}