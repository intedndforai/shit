"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, FolderPlus, Loader2, MessageSquare, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type ProjectDto } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/utils";

/** Project list plus a create form; each row opens the project workspace. */
export function ProjectManager() {
  const router = useRouter();
  const [projects, setProjects] = React.useState<ProjectDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState({ name: "", description: "", instructions: "" });

  React.useEffect(() => {
    let cancelled = false;
    api
      .listProjects()
      .then(({ projects: stored }) => {
        if (!cancelled) setProjects(stored);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load projects.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    const name = draft.name.trim();
    if (!name) {
      setError("Give the project a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.createProject({
        name,
        description: draft.description.trim() || null,
        instructions: draft.instructions.trim() || null,
      });
      setDraft({ name: "", description: "", instructions: "" });
      router.push(`/projects/${project.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the project.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="size-4 text-accent" />
            Your projects
          </CardTitle>
          <CardDescription>
            A project bundles instructions, a knowledge base, and the chats that belong to it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : projects.length ? (
            <ul className="flex flex-col gap-2">
              {projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="flex items-start gap-3 rounded-xl border border-border px-3 py-2.5 transition-colors hover:border-accent/50 hover:bg-secondary/40"
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <FolderKanban className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{project.name}</span>
                      <span className="line-clamp-2 block text-xs text-muted-foreground">
                        {project.description || project.instructions || "No description yet."}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Badge variant="outline">
                        <Paperclip className="size-3" />
                        {project.fileCount}
                      </Badge>
                      <Badge variant="outline">
                        <MessageSquare className="size-3" />
                        {project.chatCount}
                      </Badge>
                    </span>
                  </Link>
                  <p className="px-3 pt-1 text-[11px] text-muted-foreground">
                    Updated {formatRelativeTime(project.updatedAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No projects yet"
              description="Create one to give a set of chats shared instructions and a searchable knowledge base."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderPlus className="size-4 text-accent" />
            New project
          </CardTitle>
          <CardDescription>
            Instructions here are prepended to every chat inside the project.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={draft.name}
              placeholder="e.g. Platform handbook"
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-description">Description</Label>
            <Input
              id="project-description"
              value={draft.description}
              placeholder="Optional, one line"
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-instructions">Custom instructions</Label>
            <Textarea
              id="project-instructions"
              rows={3}
              value={draft.instructions}
              placeholder="e.g. Always answer from the knowledge base first and cite the file you used."
              onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))}
            />
          </div>
          <div>
            <Button variant="accent" size="sm" disabled={busy} onClick={() => void create()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FolderPlus className="size-3.5" />}
              Create project
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}