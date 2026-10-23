"use client";

import * as React from "react";
import Link from "next/link";
import { createTwoFilesPatch } from "diff";
import { toast } from "sonner";
import { Blocks, ChevronLeft, ChevronRight, Copy, Download, FileCode2, GitCompare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArtifactView } from "@/components/artifacts/artifact-view";
import { api, type ArtifactDto } from "@/lib/api-client";
import { toStandaloneHtml } from "@/lib/artifacts";
import { useChatStore } from "@/lib/store/chat-store";
import { useUIStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

/** Right-hand panel listing the artifacts captured in the active chat. */
export function ArtifactPanel() {
  const open = useUIStore((state) => state.artifactsOpen);
  const setOpen = useUIStore((state) => state.setArtifactsOpen);
  const setComposerDraft = useUIStore((state) => state.setComposerDraft);
  const chatId = useChatStore((state) => state.chatId);
  const messages = useChatStore((state) => state.messages);
  const streaming = useChatStore((state) => state.streaming);
  const send = useChatStore((state) => state.send);

  const [artifacts, setArtifacts] = React.useState<ArtifactDto[]>([]);
  const [versions, setVersions] = React.useState<ArtifactDto[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [versionIndex, setVersionIndex] = React.useState(0);
  const [showDiff, setShowDiff] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const lastMessageCount = React.useRef(0);

  // Refresh when the chat changes or a stream finishes (that is when new
  // artifact rows exist server-side).
  React.useEffect(() => {
    if (!open || !chatId) return;
    if (streaming) return;
    if (lastMessageCount.current === messages.length && selectedId) return;
    lastMessageCount.current = messages.length;

    let cancelled = false;
    api
      .listArtifacts(chatId)
      .then((result) => {
        if (cancelled) return;
        setArtifacts(result.artifacts);
        setSelectedId((current) => current ?? result.artifacts[0]?.id ?? null);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load artifacts.");
      });

    return () => {
      cancelled = true;
    };
  }, [open, chatId, messages.length, streaming, selectedId]);

  const selected = artifacts.find((artifact) => artifact.id === selectedId) ?? artifacts[0] ?? null;

  React.useEffect(() => {
    if (!selected) return;

    let cancelled = false;
    api
      .getArtifact(selected.id)
      .then((result) => {
        if (cancelled) return;
        setVersions(result.versions);
        setVersionIndex(result.versions.length - 1);
      })
      .catch(() => {
        if (!cancelled) setVersions([selected]);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Before the version list loads (or for single-version artifacts) fall back
  // to the artifact we already have.
  const availableVersions = React.useMemo(
    () => (versions.length ? versions : selected ? [selected] : []),
    [versions, selected]
  );
  const current = availableVersions[versionIndex] ?? selected;

  // Preview failures are only handed to the model when the user asks for a fix.
  const requestFix = React.useCallback(
    (message: string) => {
      if (!current || streaming) return;
      const label = current.title ?? current.identifier;
      void send(
        `The ${current.type} artifact "${label}" failed in its sandboxed preview with this error:\n\n${message}\n\n` +
          `Return a corrected version as a single <artifact identifier="${current.identifier}" type="${current.type}" title="${label}"> block. ` +
          "Keep it self-contained: no remote scripts, styles, fonts, or network requests."
      );
    },
    [current, send, streaming]
  );

  // The revision brief is never sent automatically: it lands in the composer so
  // the user can read and edit it first.
  const sendBrief = React.useCallback(
    (brief: string) => {
      setComposerDraft(brief);
      toast.info("Revision brief added to the composer. Edit it before sending.");
    },
    [setComposerDraft]
  );

  const diffText = React.useMemo(() => {
    if (availableVersions.length < 2) return "";
    const previous = availableVersions[Math.max(0, versionIndex - 1)];
    const next = availableVersions[versionIndex];
    if (!previous || !next) return "";
    return createTwoFilesPatch(
      `${next.identifier} v${previous.version}`,
      `${next.identifier} v${next.version}`,
      previous.content,
      next.content
    );
  }, [availableVersions, versionIndex]);

  const saveBlob = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const extensionFor = (type: ArtifactDto["type"]): string => {
    switch (type) {
      case "markdown":
        return "md";
      case "react":
        return "tsx";
      case "mermaid":
        return "mmd";
      case "svg":
        return "svg";
      case "html":
      case "site":
        return "html";
      default:
        return "txt";
    }
  };

  const downloadSource = () => {
    if (!current) return;
    saveBlob(current.content, `${current.identifier}.${extensionFor(current.type)}`, "text/plain;charset=utf-8");
  };

  // Exported HTML is opened from the user's disk (a file:// origin), never from
  // the app's origin, so an untrusted artifact cannot reach Conduit's storage.
  const exportHtml = () => {
    if (!current) return;
    saveBlob(toStandaloneHtml(current), `${current.identifier}.html`, "text/html;charset=utf-8");
  };

  if (!open) return null;

  return (
    <aside
      aria-label="Artifacts"
      className="flex h-full w-full max-w-[26rem] shrink-0 flex-col border-l border-border bg-background md:w-[26rem]"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Blocks className="size-4 text-accent" />
        <span className="text-sm font-medium">Artifacts</span>
        <Badge variant="outline" className="ml-1">
          {artifacts.length}
        </Badge>
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Compare versions"
                aria-pressed={showDiff}
                disabled={availableVersions.length < 2}
                onClick={() => setShowDiff((value) => !value)}
              >
                <GitCompare className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Diff versions</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon-sm" aria-label="Close artifacts panel" onClick={() => setOpen(false)}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {error ? <p className="px-3 py-2 text-xs text-destructive">{error}</p> : null}

      {!chatId ? (
        <p className="px-3 py-6 text-sm text-muted-foreground">Open a chat to see its artifacts.</p>
      ) : !artifacts.length ? (
        <div className="px-3 py-6 text-sm text-muted-foreground">
          <p>No artifacts in this chat yet.</p>
          <p className="mt-1 text-xs">
            Ask the model to wrap a self-contained HTML, SVG, Mermaid, Markdown, or code block in{" "}
            <code className="rounded bg-secondary px-1">&lt;artifact&gt;</code> tags and it will appear here.
          </p>
        </div>
      ) : (
        <>
          <ScrollArea className="max-h-40 shrink-0 border-b border-border">
            <ul className="flex flex-col gap-0.5 p-1">
              {artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(artifact.id);
                      setShowDiff(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                      artifact.id === selected?.id ? "bg-secondary" : "hover:bg-secondary/60"
                    )}
                  >
                    <span className="truncate font-medium">{artifact.title ?? artifact.identifier}</span>
                    <span className="ml-auto shrink-0 rounded-full border border-border px-1.5 text-[10px] uppercase text-muted-foreground">
                      {artifact.type}
                    </span>
                    {artifact.versionCount > 1 ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground">v{artifact.versionCount}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>

          {current ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-1 px-3 py-2 text-xs text-muted-foreground">
                <span className="truncate">v{current.version}</span>
                {availableVersions.length > 1 ? (
                  <span className="flex items-center gap-0.5 rounded-full border border-border px-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-5"
                      aria-label="Previous version"
                      disabled={versionIndex <= 0}
                      onClick={() => setVersionIndex((index) => Math.max(0, index - 1))}
                    >
                      <ChevronLeft className="size-3" />
                    </Button>
                    <span aria-live="polite">
                      {versionIndex + 1}/{availableVersions.length}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-5"
                      aria-label="Next version"
                      disabled={versionIndex >= availableVersions.length - 1}
                      onClick={() => setVersionIndex((index) => Math.min(availableVersions.length - 1, index + 1))}
                    >
                      <ChevronRight className="size-3" />
                    </Button>
                  </span>
                ) : null}
                <div className="ml-auto flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Copy artifact"
                    onClick={() => void navigator.clipboard.writeText(current.content)}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Download artifact source"
                    onClick={downloadSource}
                  >
                    <Download className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Export standalone HTML" onClick={exportHtml}>
                    <FileCode2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3">
                {showDiff && diffText ? (
                  <pre className="h-full overflow-auto rounded-xl border border-border bg-secondary/40 p-3 text-[11px] leading-relaxed">
                    {diffText}
                  </pre>
                ) : (
                  <ArtifactView
                    artifact={current}
                    onRequestFix={streaming ? undefined : requestFix}
                    onSendBrief={sendBrief}
                  />
                )}
              </div>

              <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                <Link href={`/chat/${current.chatId}`} className="underline">
                  Jump to the message
                </Link>
              </div>
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}