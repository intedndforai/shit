"use client";

import * as React from "react";
import { ArrowUp, Compass, Paperclip, Square, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AttachmentChips } from "@/components/chat/attachments/attachment-chips";
import { ChatControls } from "@/components/chat/chat-controls";
import { ToolsMenu } from "@/components/chat/tools-menu";
import { useUIStore, type DraftAttachment } from "@/lib/store/ui-store";
import { api, type ModelOptionDto, type PromptDto } from "@/lib/api-client";
import { cn, isMacPlatform } from "@/lib/utils";

/** Fills `<{text}>` (or appends) with whatever is already in the composer. */
function applyPrompt(content: string, text: string): string {
  const trimmed = text.trim();
  if (content.includes("{text}")) return content.replace(/\{text\}/g, trimmed);
  return trimmed ? `${content}\n\n${trimmed}` : content;
}

/**
 * Chat composer. Handles draft state, auto-grow, Escape-to-stop,
 * Cmd/Ctrl+Enter to send, file attachments (picker, drag-and-drop, paste),
 * slash commands for saved prompts, and @-mentions that switch the model for
 * the next turn.
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
  const pendingModelId = useUIStore((state) => state.pendingModelId);
  const setPendingModelId = useUIStore((state) => state.setPendingModelId);
  const researchMode = useUIStore((state) => state.researchMode);
  const setResearchMode = useUIStore((state) => state.setResearchMode);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [prompts, setPrompts] = React.useState<PromptDto[]>([]);
  const [models, setModels] = React.useState<ModelOptionDto[]>([]);
  // "/command" opens the saved-prompt menu; a bare "@" token switches model.
  const commandQuery = /^\/([a-z0-9-]*)$/i.exec(draft.trim())?.[1]?.toLowerCase() ?? null;
  const modelQuery = /(?:^|\s)@([a-z0-9._:-]*)$/i.exec(draft)?.[1]?.toLowerCase() ?? null;
  const menu: "command" | "model" | null = commandQuery !== null ? "command" : modelQuery !== null ? "model" : null;

  /** Highlight resets whenever the menu or the query changes, without an effect. */
  const highlightKey = `${menu ?? ""}:${commandQuery ?? ""}:${modelQuery ?? ""}`;
  const [highlightState, setHighlightState] = React.useState({ key: "", index: 0 });
  const highlight = highlightState.key === highlightKey ? highlightState.index : 0;
  const setHighlight = (next: number | ((current: number) => number)) =>
    setHighlightState((current) => ({
      key: highlightKey,
      index: typeof next === "function" ? next(current.key === highlightKey ? current.index : 0) : next,
    }));
  const readyCount = attachments.filter((attachment) => attachment.status === "ready").length;
  const uploading = attachments.some((attachment) => attachment.status === "uploading");
  const canSend = Boolean(draft.trim() || readyCount) && !uploading && !streaming && !disabled;

  const commandMatches = React.useMemo(
    () =>
      commandQuery === null
        ? []
        : prompts
            .filter((prompt) => prompt.command.includes(commandQuery) || prompt.name.toLowerCase().includes(commandQuery))
            .slice(0, 6),
    [commandQuery, prompts]
  );

  const modelMatches = React.useMemo(() => {
    if (modelQuery === null) return [];
    return models
      .filter((model) => {
        const label = `${model.displayName ?? model.externalId} ${model.externalId} ${model.providerName}`.toLowerCase();
        return label.includes(modelQuery);
      })
      .slice(0, 6);
  }, [modelQuery, models]);

  // Prompts are tiny; load them once. Models are only needed when "@" is typed.
  React.useEffect(() => {
    let cancelled = false;
    api
      .listPrompts()
      .then(({ prompts: stored }) => {
        if (!cancelled) setPrompts(stored);
      })
      .catch(() => {
        /* the slash menu just stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (modelQuery === null || models.length) return;
    let cancelled = false;
    api
      .listAllModels()
      .then(({ models: stored }) => {
        if (!cancelled) setModels(stored);
      })
      .catch(() => {
        /* no models to mention yet */
      });
    return () => {
      cancelled = true;
    };
  }, [modelQuery, models.length]);

  const pendingModel = models.find((model) => model.id === pendingModelId) ?? null;

  const focusComposer = () => requestAnimationFrame(() => textareaRef.current?.focus());

  const choosePrompt = (prompt: PromptDto) => {
    setDraft(applyPrompt(prompt.content, ""));
    focusComposer();
  };

  const chooseModel = (model: ModelOptionDto) => {
    setDraft(draft.replace(/(^|\s)@[a-z0-9._:-]*$/i, "$1").replace(/\s+$/, ""));
    setPendingModelId(model.id);
    focusComposer();
  };

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
    focusComposer();
  }, [disabled, draft, onSend, readyCount, setDraft, streaming, uploading]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const length = menu === "command" ? commandMatches.length : modelMatches.length;
      if (!length) return;
      setHighlight((current) => (current + (event.key === "ArrowDown" ? 1 : length - 1)) % length);
      return;
    }
    if (menu && (event.key === "Enter" || event.key === "Tab") && !event.metaKey && !event.ctrlKey) {
      const list = menu === "command" ? commandMatches : modelMatches;
      const choice = list[highlight];
      if (choice) {
        event.preventDefault();
        if (menu === "command") choosePrompt(choice as PromptDto);
        else chooseModel(choice as ModelOptionDto);
        return;
      }
    }
    if (event.key === "Escape" && menu) {
      event.preventDefault();
      setDraft(draft.trim() === "/" || /(?:^|\s)@[a-z0-9._:-]*$/i.test(draft) ? "" : draft);
      return;
    }
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

        {menu === "command" && commandMatches.length ? (
          <ul className="border-b border-border px-1.5 py-1" role="listbox" aria-label="Slash commands">
            {commandMatches.map((prompt, index) => (
              <li key={prompt.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choosePrompt(prompt)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
                    index === highlight ? "bg-secondary" : "hover:bg-secondary/60"
                  )}
                >
                  <span className="font-mono text-xs text-accent">/{prompt.command}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{prompt.name}</span>
                  {prompt.builtin ? null : <span className="text-[10px] uppercase text-muted-foreground">saved</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {menu === "model" && modelMatches.length ? (
          <ul className="border-b border-border px-1.5 py-1" role="listbox" aria-label="Models">
            {modelMatches.map((model, index) => (
              <li key={model.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => chooseModel(model)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
                    index === highlight ? "bg-secondary" : "hover:bg-secondary/60"
                  )}
                >
                  <Sparkles className="size-3.5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-xs">{model.displayName ?? model.externalId}</span>
                  <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{model.providerName}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

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
          placeholder="Ask anything. Conduit routes it to the model you connect. Type / for commands or @ for a model."
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

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={researchMode ? "accent" : "ghost"}
                size="icon-sm"
                aria-pressed={researchMode}
                aria-label="Deep Research"
                onClick={() => setResearchMode(!researchMode)}
              >
                <Compass className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Deep Research plans searches, reads the pages it finds, then writes a cited report. Needs a search
              provider in Settings → Tools.
            </TooltipContent>
          </Tooltip>

          {researchMode ? (
            <span className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px]">
              <Compass className="size-3 text-accent" />
              <span>Deep Research</span>
              <button
                type="button"
                aria-label="Turn off Deep Research"
                onClick={() => setResearchMode(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ) : null}

          {pendingModelId ? (
            <span className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px]">
              <Sparkles className="size-3 text-accent" />
              <span className="max-w-[10rem] truncate">
                {pendingModel ? pendingModel.displayName ?? pendingModel.externalId : "Next turn"}
              </span>
              <button
                type="button"
                aria-label="Clear the model switch"
                onClick={() => setPendingModelId(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ) : (
            <span className="ml-2 hidden text-[11px] text-muted-foreground sm:inline">
              {isMacPlatform() ? "⌘" : "Ctrl"}+Enter to send · Esc to stop
            </span>
          )}

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