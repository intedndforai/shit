"use client";

import * as React from "react";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AttachmentChips } from "@/components/chat/attachments/attachment-chips";
import { ChatControls } from "@/components/chat/chat-controls";
import { ToolsMenu } from "@/components/chat/tools-menu";
import { useUIStore, type DraftAttachment } from "@/lib/store/ui-store";
import { api } from "@/lib/api-client";
import { cn, isMacPlatform } from "@/lib/utils";

/**
 * Chat composer. Handles draft state, auto-grow, Escape-to-stop,
 * Cmd/Ctrl+Enter to send, and file attachments (picker, drag-and-drop, paste).
 * The tools menu toggles the built-in tool set per conversation.
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
  const attachments = useUIStore((state) => state.attachments);
  const addAttachments = useUIStore((state) => state.addAttachments);
  const updateAttachment = useUIStore((state) => state.updateAttachment);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const readyCount = attachments.filter((attachment) => attachment.status === "ready").length;
  const uploading = attachments.some((attachment) => attachment.status === "uploading");
  const canSend = Boolean(draft.trim() || readyCount) && !uploading && !streaming && !disabled;

  const uploadFiles = React.useCallback(
    async (files: File[]) => {
      if (!files.length) return;

      const drafts: DraftAttachment[] = files.map((file, index) => ({
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name || "pasted-file",
        mime: file.type || "application/octet-stream",
        size: file.size,
        status: "uploading",
      }));
      addAttachments(drafts);

      await Promise.all(
        drafts.map(async (draft, index) => {
          try {
            const { file } = await api.uploadFile(files[index]);
            updateAttachment(draft.id, {
              status: "ready",
              kind: file.kind,
              mime: file.mime,
              size: file.size,
              text: file.text,
              dataUrl: file.dataUrl,
              url: file.url,
              truncated: file.truncated,
            });
          } catch (error) {
            updateAttachment(draft.id, {
              status: "error",
              error: error instanceof Error ? error.message : "Upload failed.",
            });
          }
        })
      );
    },
    [addAttachments, updateAttachment]
  );

  const submit = React.useCallback(() => {
    const value = draft.trim();
    if ((!value && !readyCount) || uploading || streaming || disabled) return;
    onSend(value);
    setDraft("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [disabled, draft, onSend, readyCount, setDraft, streaming, uploading]);

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
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (files.length) void uploadFiles(files);
        }}
        className={cn(
          "rounded-2xl border bg-card shadow-soft transition-colors focus-within:border-accent/70",
          dragging ? "border-accent/80 bg-accent/5" : "border-border"
        )}
      >
        {dragging ? (
          <p className="px-4 pt-3 text-xs text-muted-foreground">Drop files to attach them.</p>
        ) : null}

        <AttachmentChips />

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
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length) {
              event.preventDefault();
              void uploadFiles(files);
            }
          }}
          placeholder="Ask anything. Conduit routes it to the model you connect."
          className="max-h-[220px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.yaml,.yml,.xml,.html,.css,.js,.mjs,.cjs,.ts,.tsx,.py,.sql,.sh,.pdf,.docx,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) void uploadFiles(files);
            }}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Attach files"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attach text, PDF, DOCX, XLSX, or images</TooltipContent>
          </Tooltip>

          <ToolsMenu />

          <ChatControls />

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
                disabled={!canSend}
                className={cn(!canSend && "opacity-60")}
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