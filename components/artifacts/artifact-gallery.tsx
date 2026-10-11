"use client";

import * as React from "react";
import Link from "next/link";
import { Blocks } from "lucide-react";
import { ArtifactView } from "@/components/artifacts/artifact-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { api, type ArtifactDto } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

/** Library of every artifact captured across all chats. */
export function ArtifactGallery() {
  const [artifacts, setArtifacts] = React.useState<ArtifactDto[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<string>("all");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .listArtifacts()
      .then((result) => {
        if (cancelled) return;
        setArtifacts(result.artifacts);
        setSelectedId(result.artifacts[0]?.id ?? null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load artifacts.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const types = React.useMemo(() => ["all", ...new Set(artifacts.map((artifact) => artifact.type))], [artifacts]);
  const visible = artifacts.filter((artifact) => filter === "all" || artifact.type === filter);
  const selected = visible.find((artifact) => artifact.id === selectedId) ?? visible[0] ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Blocks className="size-4 text-accent" />
          Artifact library
        </CardTitle>
        <CardDescription>
          Every HTML, SVG, Mermaid, Markdown, or code artifact a model has produced, with its full version
          history.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !artifacts.length ? (
          <EmptyState
            title="No artifacts yet"
            description="Ask a model to wrap a self-contained block in <artifact> tags and it will show up here."
          />
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {types.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFilter(type)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    filter === type
                      ? "border-accent/60 bg-accent/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary/60"
                  )}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
              <ul className="flex flex-col gap-1">
                {visible.map((artifact) => (
                  <li key={artifact.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(artifact.id)}
                      className={cn(
                        "flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                        artifact.id === selected?.id
                          ? "border-accent/50 bg-accent/5"
                          : "border-border hover:bg-secondary/50"
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{artifact.title ?? artifact.identifier}</span>
                        <Badge variant="outline" className="shrink-0">
                          {artifact.type}
                        </Badge>
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatRelativeTime(artifact.createdAt)}
                        {artifact.versionCount > 1 ? ` · ${artifact.versionCount} versions` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="flex min-h-[22rem] flex-col rounded-xl border border-border p-3">
                {selected ? (
                  <>
                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate font-medium text-foreground">
                        {selected.title ?? selected.identifier}
                      </span>
                      <Link href={`/chat/${selected.chatId}`} className="underline">
                        Open chat
                      </Link>
                      <span className="ml-auto">v{selected.version}</span>
                    </div>
                    <div className="min-h-0 flex-1">
                      <ArtifactView artifact={selected} />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Select an artifact to preview it.</p>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}