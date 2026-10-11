"use client";

import * as React from "react";
import { Brain, Check, Copy, Pencil, RefreshCw, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { VersionSwitcher } from "@/components/chat/version-switcher";
import { useChatStore, textOf, thinkingOf, type UiMessage } from "@/lib/store/chat-store";

/** One conversation turn: user bubble or rendered assistant answer. */
export function MessageItem({
  message,
  isLastAssistant,
  onRegenerate,
}: {
  message: UiMessage;
  isLastAssistant: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const [showThinking, setShowThinking] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  const editingId = useChatStore((state) => state.editingId);
  const setEditing = useChatStore((state) => state.setEditing);
  const editMessage = useChatStore((state) => state.editMessage);
  const switchBranch = useChatStore((state) => state.switchBranch);

  const text = textOf(message);
  const thinking = thinkingOf(message);
  const isUser = message.role === "user";
  const editing = editingId === message.id;
  const siblingIndex = message.siblingIndex ?? 0;
  const siblingCount = message.siblingCount ?? 1;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const startEdit = () => {
    setDraft(text);
    setEditing(message.id);
  };

  const branchTo = (direction: "prev" | "next") => {
    // Sibling ids are not all on the active path, so the server resolves the
    // neighbouring version of this turn and moves the visible leaf to it.
    void switchBranch(message.id, direction);
  };

  if (isUser) {
    return (
      <div className="group flex flex-col items-end gap-1">
        {editing ? (
          <div className="w-full rounded-2xl border border-accent/60 bg-card p-3">
            <Textarea
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-[80px] border-0 bg-transparent p-0 focus-visible:outline-none"
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void editMessage(message.id, draft);
                }
                if (event.key === "Escape") setEditing(null);
              }}
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <span className="mr-auto text-[11px] text-muted-foreground">
                Saving creates a new branch — nothing is overwritten.
              </span>
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                <X className="size-3.5" />
                Cancel
              </Button>
              <Button size="sm" onClick={() => void editMessage(message.id, draft)} disabled={!draft.trim()}>
                Save and regenerate
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-2.5 text-[15px] leading-relaxed">
              {text}
            </div>
            <div className="flex items-center gap-1">
              <VersionSwitcher
                index={siblingIndex}
                count={siblingCount}
                onPrev={() => branchTo("prev")}
                onNext={() => branchTo("next")}
              />
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <Button variant="ghost" size="icon-sm" aria-label="Copy message" onClick={copy}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Edit message" onClick={startEdit}>
                  <Pencil className="size-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <article className="group flex flex-col gap-2" aria-label="Assistant message">
      {thinking ? (
        <div className="rounded-xl border border-border bg-secondary/40">
          <button
            type="button"
            onClick={() => setShowThinking((value) => !value)}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
            aria-expanded={showThinking}
          >
            <Brain className="size-3.5" />
            <span>{message.streaming && !text ? "Thinking..." : "Thought process"}</span>
            <span className="ml-auto">{showThinking ? "Hide" : "Show"}</span>
          </button>
          {showThinking ? (
            <p className="whitespace-pre-wrap border-t border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {thinking}
            </p>
          ) : null}
        </div>
      ) : null}

      {text ? (
        <MarkdownRenderer content={text} />
      ) : message.streaming ? (
        <p className="text-sm text-muted-foreground">Waiting for the first token...</p>
      ) : null}

      {message.streaming && text ? (
        <span className="inline-block h-4 w-[3px] animate-pulse rounded-full bg-accent align-middle" />
      ) : null}

      {message.error ? (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{message.error}</span>
          {isLastAssistant ? (
            <button type="button" onClick={onRegenerate} className="shrink-0 underline">
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button variant="ghost" size="icon-sm" aria-label="Copy answer" onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
        {isLastAssistant && !message.streaming ? (
          <Button variant="ghost" size="icon-sm" aria-label="Regenerate answer" onClick={onRegenerate}>
            <RefreshCw className="size-3.5" />
          </Button>
        ) : null}
        <VersionSwitcher
          index={siblingIndex}
          count={siblingCount}
          onPrev={() => branchTo("prev")}
          onNext={() => branchTo("next")}
        />
        {message.usage?.totalTokens ? (
          <Badge variant="outline" className="ml-1">
            {message.usage.totalTokens} tokens
          </Badge>
        ) : null}
        {message.cost ? (
          <Badge variant="outline" className="ml-1">
            ${message.cost.toFixed(4)}
          </Badge>
        ) : null}
      </div>
    </article>
  );
}