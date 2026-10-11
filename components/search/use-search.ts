"use client";

import * as React from "react";
import { api, type SearchHit } from "@/lib/api-client";

/** Debounced search over chat titles and message bodies. */
export function useSearch(query: string, delayMs = 220) {
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const trimmed = query.trim();
    let cancelled = false;

    // Everything runs inside the timer callback so the effect body never calls
    // setState synchronously (react-hooks/set-state-in-effect).
    const timer = window.setTimeout(() => {
      if (cancelled) return;

      if (trimmed.length < 2) {
        setHits([]);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      api
        .search(trimmed)
        .then((result) => {
          if (cancelled) return;
          setHits(result.hits);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setError(cause instanceof Error ? cause.message : "Search failed.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, delayMs]);

  return { hits, loading, error };
}