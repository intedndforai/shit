"use client";

import * as React from "react";
import { Search as SearchIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchEmptyHint, SearchResults, SearchSpinner } from "@/components/search/search-results";
import { useSearch } from "@/components/search/use-search";

/** Full-page search over chat titles and message bodies. */
export function SearchPanel() {
  const [query, setQuery] = React.useState("");
  const { hits, loading, error } = useSearch(query);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SearchIcon className="size-4 text-accent" />
          Search your history
        </CardTitle>
        <CardDescription>
          Matches include chat titles and message text. Press Ctrl+K anywhere for the quick switcher.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats and messages…"
          aria-label="Search chats and messages"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-accent/70"
        />
        <div className="rounded-lg border border-border">
          {loading ? <SearchSpinner /> : null}
          {!loading && hits.length ? (
            <SearchResults hits={hits} query={query} loading={loading} error={error} />
          ) : null}
          {!loading && !hits.length ? <SearchEmptyHint /> : null}
        </div>
      </CardContent>
    </Card>
  );
}