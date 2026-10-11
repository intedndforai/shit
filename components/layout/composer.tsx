"use client";

import * as React from "react";
import { ArrowUp, Compass, Paperclip, ShieldAlert, Square, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AttachmentChips } from "@/components/chat/attachments/attachment-chips";
import { ChatControls } from "@/components/chat/chat-controls";
import { ToolsMenu } from "@/components/chat/tools-menu";
import { ModelSelector } from "@/components/chat/model-selector";
import { PrivacyBadge } from "@/components/privacy/privacy-badge";
import { SendInspector } from "@/components/privacy/send-inspector";
import { PrivacyBlockDialog } from "@/components/privacy/privacy-block-dialog";
import { useUIStore, type DraftAttachment } from "@/lib/store/ui-store";
import { useChatStore } from "@/lib/store/chat-store";
import { api, type ModelOptionDto, type PromptDto, type PrivacyStateDto } from "@/lib/api-client";
import { prepareImageForUpload } from "@/lib/files/image-client";
import { estimateTokens } from "@/lib/tokens";
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
  lastUserText,
  onStop,
  streaming = false,
  disabled = false,
}: {
  onSend: (text: string) => void;
  lastUserText?: string | null;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
}) {
  const draft = useUIStore((state) => state.composerDraft);
  const setDraft = useUIStore((state) => state.setComposerDraft);
  const attachments = useUIStore((state) => state.attachments);
  const chatModelId = useChatStore((state) => state.chatModelId);
  const addAttachments = useUIStore((state) => state.addAttachments);
  const updateAttachment = useUIStore((state) => state.updateAttachment);
  const pendingModelId = useUIStore((state) => state.pendingModelId);
  const setPendingModelId = useUIStore((state) => state.setPendingModelId);
  const researchMode = useUIStore((state) => state.researchMode);
  const setResearchMode = useUIStore((state) => state.setResearchMode);

  // Privacy badges: the mode comes from the chat, the destination from the
  // workspace privacy state (Section 5).
  const providerId = useChatStore((state) => state.chatProviderId);
  const privacyMode = useChatStore((state) => state.chatPrivacyMode);
  const messages = useChatStore((state) => state.messages);
  const [privacyState, setPrivacyState] = React.useState<PrivacyStateDto | null>(null);

  React.useEffect(() => {
    let alive = true;
    api
      .getPrivacy()
      .then((state) => {
        if (alive) setPrivacyState(state);
      })
      .catch(() => {
        /* the badge simply falls back to the mode */
      });
    return () => {
      alive = false;
    };
  }, [providerId]);

  const activeProvider = privacyState?.providers.find((provider) => provider.id === providerId) ?? null;

  const redactionNotice = React.useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant") {
        return message.redactions?.applied ? message.redactions : null;
      }
    }
    return null;
  }, [messages]);

  /** Builds the "what will be sent" payload from the live composer state. */
  const buildPreviewRequest = React.useCallback((): Record<string, unknown> => {
    const store = useChatStore.getState();
    const files = useUIStore
      .getState()
      .attachments.filter((attachment) => attachment.status === "ready");
    const parts = files.map((attachment) =>
      attachment.kind === "image" || attachment.mime.startsWith("image/")
        ? { kind: "image", alt: attachment.name, attachmentId: attachment.serverId }
        : {
            kind: "document",
            name: attachment.name,
            mime: attachment.mime,
            attachmentId: attachment.serverId,
            text: attachment.text,
          }
    );
    const trimmed = useUIStore.getState().composerDraft.trim();
    const message =
      parts.length && trimmed
        ? [{ kind: "text", text: trimmed }, ...parts]
        : parts.length
          ? parts
          : trimmed || undefined;
    const ephemeral =
      store.chatIncognito || store.chatPrivacyMode === "incognito" || store.chatPrivacyMode === "local";
    return {
      chatId: store.chatId,
      message,
      toolsEnabled: useUIStore.getState().pendingTools,
      modelId: useUIStore.getState().pendingModelId ?? undefined,
      history: ephemeral
        ? store.messages
            .filter((item) => !item.streaming)
            .map((item) => ({ role: item.role, content: item.content }))
        : undefined,
    };
  }, []);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [prompts, setPrompts] = React.useState<PromptDto[]>([]);
  const [models, setModels] = React.useState<ModelOptionDto[]>([]);
  const [modelsLoaded, setModelsLoaded] = React.useState(false);
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

  // Image routing: only a vision-configured model may receive an image. The
  // server enforces this too; the composer explains it before the turn is sent.
  const activeModelId = pendingModelId ?? chatModelId;
  const activeModel =
    models.find((model) => model.id === activeModelId) ?? models.find((model) => model.isDefault) ?? null;
  const hasImages = attachments.some(
    (attachment) =>
      attachment.status !== "error" && (attachment.kind === "image" || attachment.mime.startsWith("image/"))
  );
  const visionUnavailable =
    hasImages && modelsLoaded && (activeModel === null || activeModel.capabilities?.vision !== true);

  const canSend =
    Boolean(draft.trim() || readyCount) && !uploading && !streaming && !disabled && !visionUnavailable;

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
    let cancelled = false;
    api
      .listAllModels()
      .then(({ models: stored }) => {
        if (!cancelled) setModels(stored);
      })
      .catch(() => {
        /* the @-mention picker and the vision check stay unavailable */
      })
      .finally(() => {
        if (!cancelled) setModelsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        progress: 0,
      }));
      addAttachments(drafts);

      await Promise.all(
        drafts.map(async (draft, index) => {
          try {
            // Shrink large photos in the browser before they ever leave it.
            const prepared = await prepareImageForUpload(files[index]);
            const { file } = await api.uploadFile(prepared, (percent) =>
              updateAttachment(draft.id, { progress: percent })
            );
            const tokens = file.kind === "image" ? 1024 : file.text ? estimateTokens(file.text) : undefined;
            updateAttachment(draft.id, {
              status: "ready",
              serverId: file.id,
              kind: file.kind,
              mime: file.mime,
              size: file.size,
              text: file.text,
              dataUrl: file.dataUrl,
              url: file.url,
              truncated: file.truncated,
              note: file.note,
              progress: 100,
              tokens,
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
    if (event.key === "ArrowUp" && !draft.trim() && !menu && lastUserText) {
      event.preventDefault();
      setDraft(lastUserText ?? "");
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

        {visionUnavailable ? (
          <p className="border-b border-border px-4 py-2 text-xs text-destructive">
            {activeModel
              ? `${activeModel.displayName ?? activeModel.externalId} is not configured for vision. Remove the image attachments, type @ to switch to a vision model, or enable vision for this model in Settings.`
              : "No model is configured yet, so images cannot be sent. Add a provider and model in Settings."}
          </p>
        ) : null}

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
            accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.yaml,.yml,.xml,.html,.css,.js,.mjs,.cjs,.ts,.tsx,.py,.sql,.sh,.pdf,.docx,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif,.zip"
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
            <TooltipContent>Attach text, PDF, DOCX, XLSX, images, or a ZIP archive</TooltipContent>
          </Tooltip>

          <ModelSelector />

          <ToolsMenu />

          <ChatControls />

          <PrivacyBadge
            mode={privacyMode}
            destination={
              activeProvider
                ? {
                    kind: activeProvider.local ? "local" : "provider",
                    label: activeProvider.name,
                    host: activeProvider.host,
                  }
                : undefined
            }
            policyLabel={activeProvider?.label ?? null}
          />

          <SendInspector buildRequest={buildPreviewRequest} />

          {redactionNotice ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                  <ShieldAlert className="size-3" aria-hidden />
                  {redactionNotice.total} masked
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>
                  {redactionNotice.total} value{redactionNotice.total === 1 ? "" : "s"} masked before this request
                  — the answer may be less specific. Originals were restored in the reply.
                </p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {redactionNotice.items.map((item) => (
                    <li key={item.placeholder} className="font-mono">
                      {item.placeholder} · {item.preview}
                    </li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          ) : null}

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
        Conduit never ships with a hardcoded AI vendor. Provider policy labels are user-declared —
        Conduit cannot verify what a third-party provider does with your data.
      </p>
      <PrivacyBlockDialog />
    </div>
  );
}