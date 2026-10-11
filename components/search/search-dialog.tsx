"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search as SearchIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchEmptyHint, SearchResults, SearchSpinner } from "@/components/search/search-results";
import { useSearch } from "@/components/search/use-search";
import { useUIStore } from "@/lib/store/ui-store";
import { shortcutLabel } from "@/lib/utils";

/** Global Ctrl/Cmd+K command dialog for searching chats and messages. */
export function SearchDialog() {
  const open = useUIStore((state) => state.searchOpen);
  const setOpen = useUIStore((state) => state.setSearchOpen);
  const router = useRouter();

  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const { hits, loading, error } = useSearch(query);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === "Escape" && useUIStore.getState().searchOpen) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  React.useEffect(() => {
    if (!open) return;
    // Reset and focus from a timer callback so the effect body stays free of
    // synchronous state updates (react-hooks/set-state-in-effect).
    const id = window.setTimeout(() => {
      setActiveIndex(0);
      inputRef.current?.focus();
    }, 10);
    return () => window.clearTimeout(id);
  }, [open]);

  const commit = (index: number) => {
    const hit = hits[index];
    setOpen(false);
    setQuery("");
    if (hit) router.push(`/chat/${hit.chatId}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[12%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Search chats</DialogTitle>
        <DialogDescription className="sr-only">
          Search across every chat title and message you have stored.
        </DialogDescription>

        <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, Math.max(hits.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                commit(activeIndex);
              }
            }}
            placeholder="Search chats and messages…"
            aria-label="Search chats and messages"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
            {shortcutLabel("Mod+K")}
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? <SearchSpinner /> : null}
          {!loading && hits.length ? (
            <SearchResults
              hits={hits}
              query={query}
              loading={loading}
              error={error}
              activeIndex={activeIndex}
              onHover={setActiveIndex}
              onSelect={() => {
                setQuery("");
              }}
            />
          ) : null}
          {!loading && !hits.length ? <SearchEmptyHint /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}