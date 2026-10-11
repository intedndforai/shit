"use client";

import * as React from "react";
import { Brain, Check, Copy, RefreshCw, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { textOf, thinkingOf, type UiMessage } from "@/lib/store/chat-store";

/** One conversation turn: user bubble or assistant prose with actions. */
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

  const text = textOf(message);
  const thinking = thinkingOf(message);
  const isUser = message.role === "user";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-2.5 text-[15px] leading-relaxed">
          {text}
        </div>
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
        <div className="prose-serif whitespace-pre-wrap break-words">{text}</div>
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

      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button variant="ghost" size="icon-sm" aria-label="Copy message" onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
        {isLastAssistant && !message.streaming ? (
          <Button variant="ghost" size="icon-sm" aria-label="Regenerate answer" onClick={onRegenerate}>
            <RefreshCw className="size-3.5" />
          </Button>
        ) : null}
        {message.usage?.totalTokens ? (
          <Badge variant="outline" className="ml-1">
            {message.usage.totalTokens} tokens
          </Badge>
        ) : null}
        {message.cost ? (
          <Badge variant="outline" className={cn("ml-1")}>
            ${message.cost.toFixed(4)}
          </Badge>
        ) : null}
      </div>
    </article>
  );
}