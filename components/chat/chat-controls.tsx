"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type StoredPreset } from "@/lib/api-client";
import { BUILTIN_PRESETS, matchPreset, type ChatPreset } from "@/lib/presets";
import { useChatStore } from "@/lib/store/chat-store";

interface Controls {
  temperature: number;
  topP: number;
  maxTokens: number;
  thinkingBudget: number | null;
  systemPrompt: string | null;
}

function Range({
  id,
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-accent"
      />
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * Per-chat generation controls: sampling, output length, thinking budget, and
 * the system prompt, plus quick presets. Values are saved onto the chat, so the
 * next turn uses them without re-sending anything.
 */
export function ChatControls() {
  const chatId = useChatStore((state) => state.chatId);
  const temperature = useChatStore((state) => state.chatTemperature);
  const topP = useChatStore((state) => state.chatTopP);
  const maxTokens = useChatStore((state) => state.chatMaxTokens);
  const thinkingBudget = useChatStore((state) => state.chatThinkingBudget);
  const systemPrompt = useChatStore((state) => state.chatSystemPrompt);
  const reasoningCapable = useChatStore((state) => state.chatReasoningCapable);
  const updateChatSettings = useChatStore((state) => state.updateChatSettings);

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Controls>({
    temperature,
    topP,
    maxTokens,
    thinkingBudget,
    systemPrompt,
  });
  const [presets, setPresets] = React.useState<ChatPreset[]>(BUILTIN_PRESETS);
  const [saving, setSaving] = React.useState(false);

  /** Opening the dialog re-seeds the draft from the chat's saved values. */
  const changeOpen = (next: boolean) => {
    if (next) setDraft({ temperature, topP, maxTokens, thinkingBudget, systemPrompt });
    setOpen(next);
  };

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .listPresets()
      .then(({ presets: stored }) => {
        if (cancelled) return;
        setPresets([...BUILTIN_PRESETS, ...(stored as StoredPreset[]).map((preset) => ({ ...preset, builtin: false }))]);
      })
      .catch(() => {
        /* presets are optional */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const activePreset = matchPreset(presets, draft);

  const apply = async () => {
    setSaving(true);
    await updateChatSettings({
      temperature: draft.temperature,
      topP: draft.topP,
      maxTokens: draft.maxTokens,
      thinkingBudget: draft.thinkingBudget,
      systemPrompt: draft.systemPrompt?.trim() ? draft.systemPrompt : null,
    });
    setSaving(false);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Chat settings" disabled={!chatId}>
          <SlidersHorizontal className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Chat settings</DialogTitle>
          <DialogDescription>
            Sampling, output length, and thinking apply to this conversation only.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset">Preset</Label>
            <select
              id="preset"
              className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-accent/70"
              value={activePreset?.id ?? "custom"}
              onChange={(event) => {
                const preset = presets.find((item) => item.id === event.target.value);
                if (!preset) return;
                setDraft((current) => ({
                  ...current,
                  temperature: preset.temperature,
                  topP: preset.topP,
                  maxTokens: preset.maxTokens,
                  thinkingBudget: preset.thinkingBudget ?? null,
                  systemPrompt: preset.systemPrompt ?? current.systemPrompt,
                }));
              }}
            >
              <option value="custom" disabled>
                Custom
              </option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                  {preset.builtin ? "" : " (saved)"}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Manage your own presets in Settings. The built-in four always work.
            </p>
          </div>

          <Range
            id="temperature"
            label="Temperature"
            hint="Lower is more predictable, higher is more varied."
            value={draft.temperature}
            min={0}
            max={2}
            step={0.05}
            format={(value) => value.toFixed(2)}
            onChange={(value) => setDraft((current) => ({ ...current, temperature: value }))}
          />

          <Range
            id="top-p"
            label="Top P"
            hint="Nucleus sampling. 1 lets the model consider every token."
            value={draft.topP}
            min={0.05}
            max={1}
            step={0.05}
            format={(value) => value.toFixed(2)}
            onChange={(value) => setDraft((current) => ({ ...current, topP: value }))}
          />

          <Range
            id="max-tokens"
            label="Max output tokens"
            hint="A ceiling for one answer. The model's own limit still applies."
            value={draft.maxTokens}
            min={256}
            max={64000}
            step={256}
            format={(value) => String(value)}
            onChange={(value) => setDraft((current) => ({ ...current, maxTokens: value }))}
          />

          <Range
            id="thinking-budget"
            label="Thinking budget"
            hint={
              reasoningCapable
                ? "Tokens the model may spend thinking before it answers. 0 turns it off."
                : "This model is not marked as reasoning-capable in Settings; the value is sent as-is."
            }
            value={draft.thinkingBudget ?? 0}
            min={0}
            max={32000}
            step={500}
            format={(value) => (value === 0 ? "off" : String(value))}
            onChange={(value) =>
              setDraft((current) => ({ ...current, thinkingBudget: value === 0 ? null : value }))
            }
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="system-prompt">System prompt</Label>
            <Textarea
              id="system-prompt"
              rows={3}
              value={draft.systemPrompt ?? ""}
              placeholder="Optional. Overrides the default instructions for this chat."
              onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="accent" onClick={() => void apply()} disabled={saving}>
            Apply to this chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}