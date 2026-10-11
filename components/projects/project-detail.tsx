"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Database,
  FileText,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Save,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type ProjectDto, type ProjectFileDto } from "@/lib/api-client";
import { ProjectSkills } from "@/components/projects/project-skills";
import { useChatStore } from "@/lib/store/chat-store";
import { formatBytes, formatRelativeTime } from "@/lib/utils";

interface ProjectDetailState {
  project: ProjectDto;
  files: ProjectFileDto[];
  chats: Array<{ id: string; title: string | null; updatedAt: number }>;
  stats: { files: number; chunks: number; embedded: number };
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  indexing: "Indexing…",
  indexed: "Indexed",
  failed: "Could not read",
};

/**
 * One project's workspace: instructions, the knowledge base, and every chat
 * scoped to it. Uploading a file extracts its text, chunks it, and (with an
 * embeddings model configured) embeds it for retrieval.
 */
export function ProjectDetail({ projectId }: { projectId: string }) {
  const router = useRouter();
  const startChat = useChatStore((state) => state.newChat);

  const [state, setState] = React.useState<ProjectDetailState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState({ name: "", description: "", instructions: "" });
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    try {
      const data = await api.getProject(projectId);
      setState(data);
      setDraft({
        name: data.project.name,
        description: data.project.description ?? "",
        instructions: data.project.instructions ?? "",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this project.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => {
    let cancelled = false;
    api
      .getProject(projectId)
      .then((data) => {
        if (cancelled) return;
        setState(data);
        setDraft({
          name: data.project.name,
          description: data.project.description ?? "",
          instructions: data.project.instructions ?? "",
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load this project.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const saveDetails = async () => {
    if (!draft.name.trim()) {
      setError("A project needs a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateProject(projectId, {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        instructions: draft.instructions.trim() || null,
      });
      await load();
      setNotice("Saved.");
      window.setTimeout(() => setNotice(null), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the project.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of files) {
        const { file: attachment } = await api.uploadFile(file);
        await api.attachProjectFile(projectId, { attachmentId: attachment.id });
      }
      await load();
      setNotice(`Indexed ${files.length} file${files.length === 1 ? "" : "s"}.`);
      window.setTimeout(() => setNotice(null), 2500);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not index that file. Text-based documents work best."
      );
    } finally {
      setBusy(false);
    }
  };

  const removeFile = async (file: ProjectFileDto) => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteProjectFile(projectId, file.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove that file.");
    } finally {
      setBusy(false);
    }
  };

  const openNewChat = async () => {
    setBusy(true);
    setError(null);
    const chatId = await startChat({ projectId });
    setBusy(false);
    if (chatId) router.push(`/chat/${chatId}`);
  };

  const removeProject = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteProject(projectId);
      router.push("/projects");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the project.");
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading project…</p>;
  }

  if (!state) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-destructive" />
            Project unavailable
          </CardTitle>
          <CardDescription>{error ?? "This project no longer exists."}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/projects">
              <ArrowLeft className="size-3.5" /> Back to projects
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { project, files, chats, stats } = state;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button asChild variant="ghost" size="sm">
          <Link href="/projects">
            <ArrowLeft className="size-3.5" /> Projects
          </Link>
        </Button>
        <Badge variant="outline">{stats.chunks} chunks</Badge>
        <Badge variant="outline">{stats.embedded} embedded</Badge>
        {stats.files > 0 && stats.embedded === 0 ? (
          <Badge variant="warning" title="Set an embeddings model in Settings to enable vector search">
            keyword search
          </Badge>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>{project.name}</CardTitle>
          <CardDescription>Name, description, and the instructions every chat inherits.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="detail-name">Name</Label>
              <Input
                id="detail-name"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="detail-description">Description</Label>
              <Input
                id="detail-description"
                value={draft.description}
                placeholder="Optional, one line"
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="detail-instructions">Custom instructions</Label>
            <Textarea
              id="detail-instructions"
              rows={4}
              value={draft.instructions}
              placeholder="e.g. Prefer answers drawn from the attached handbook; say so when the knowledge base does not cover something."
              onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="accent" disabled={busy} onClick={() => void saveDetails()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save project
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void openNewChat()}>
              <MessageSquarePlus className="size-3.5" />
              New chat in this project
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="ghost" className="ml-auto text-destructive" disabled={busy}>
                  <Trash2 className="size-3.5" />
                  Delete project
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Delete “{project.name}”?</DialogTitle>
                  <DialogDescription>
                    Its files, chunks, and project-scoped chats are removed. This cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="destructive" onClick={() => void removeProject()} disabled={busy}>
                    Delete project
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4 text-accent" />
            Knowledge base
          </CardTitle>
          <CardDescription>
            Text, Markdown, PDF, DOCX, and spreadsheets are extracted, chunked, and retrieved with citations.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.yaml,.yml,.xml,.html,.css,.js,.mjs,.cjs,.ts,.tsx,.py,.sql,.sh,.pdf,.docx,.xlsx,.xls"
              onChange={(event) => {
                const chosen = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (chosen.length) void upload(chosen);
              }}
            />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => fileInputRef.current?.click()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              Add files
            </Button>
            <span className="text-xs text-muted-foreground">
              {stats.files} file{stats.files === 1 ? "" : "s"} · retrieved automatically in this project&apos;s chats
            </span>
          </div>

          {files.length ? (
            <ul className="flex flex-col gap-1.5">
              {files.map((file) => (
                <li key={file.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{file.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatBytes(file.size)} · {STATUS_LABEL[file.status] ?? file.status} ·{" "}
                      {file.chunkCount} chunk{file.chunkCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${file.name}`}
                    disabled={busy}
                    onClick={() => void removeFile(file)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No files yet. Add a document and every chat in this project can search it.
            </p>
          )}
        </CardContent>
      </Card>


      <ProjectSkills projectId={projectId} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Paperclip className="size-4 text-accent" />
            Chats in this project
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {chats.length ? (
            <ul className="flex flex-col gap-1.5">
              {chats.map((chat) => (
                <li key={chat.id}>
                  <Link
                    href={`/chat/${chat.id}`}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-accent/50 hover:bg-secondary/40"
                  >
                    <span className="min-w-0 flex-1 truncate">{chat.title ?? "New chat"}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatRelativeTime(chat.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No chats yet. Use “New chat in this project” to start one.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}