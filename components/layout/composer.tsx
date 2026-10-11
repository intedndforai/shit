"use client";

import * as React from "react";
import { ArrowUp, Paperclip, Plus, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUIStore } from "@/lib/store/ui-store";
import { cn, isMacPlatform } from "@/lib/utils";

/**
 * Chat composer. Handles draft state, auto-grow, Escape-to-stop, and
 * Cmd/Ctrl+Enter to send. Attachments and the tools menu arrive in M4/M6.
 */
export function Composer({
  onSend,
  onStop,
  streaming = false,
  disabled = false,
}: {
  onSend: (text: string) => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
}) {
  const draft = useUIStore((state) => state.composerDraft);
  const setDraft = useUIStore((state) => state.setComposerDraft);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const submit = React.useCallback(() => {
    const value = draft.trim();
    if (!value || streaming || disabled) return;
    onSend(value);
    setDraft("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [disabled, draft, onSend, setDraft, streaming]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "Escape" && streaming) {
      event.preventDefault();
      onStop?.();
    }
  };

  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      <div className="rounded-2xl border border-border bg-card shadow-soft transition-colors focus-within:border-accent/70">
        <label htmlFor="composer" className="sr-only">
          Message Conduit
        </label>
        <textarea
          id="composer"
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask anything. Conduit routes it to the model you connect."
          className="max-h-[220px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Attach files" disabled>
                <Paperclip className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attachments (Milestone 4)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Tools and MCP servers" disabled>
                <Plus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Tools (Milestone 6)</TooltipContent>
          </Tooltip>

          <span className="ml-2 hidden text-[11px] text-muted-foreground sm:inline">
            {isMacPlatform() ? "⌘" : "Ctrl"}+Enter to send · Esc to stop
          </span>

          <div className="ml-auto flex items-center gap-2">
            {streaming ? (
              <Button variant="secondary" size="sm" onClick={onStop} aria-label="Stop generating">
                <Square className="size-3.5" />
                Stop
              </Button>
            ) : (
              <Button
                variant="accent"
                size="icon-sm"
                aria-label="Send message"
                onClick={submit}
                disabled={!draft.trim() || disabled}
                className={cn((!draft.trim() || disabled) && "opacity-60")}
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      <p className="px-1 pt-2 text-center text-[11px] text-muted-foreground">
        Conduit never ships with a hardcoded AI vendor. You choose the Base URL and key.
      </p>
    </div>
  );
}