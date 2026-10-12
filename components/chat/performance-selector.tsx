"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Gauge, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, type PresetOptionDto } from "@/lib/api-client";
import { matchPreset } from "@/lib/presets";
import { useChatStore } from "@/lib/store/chat-store";
import { cn } from "@/lib/utils";

/**
 * "AI performance" selector.
 *
 * A level is a named preset: sampling, output length, and thinking budget.
 * With a chat open it updates that conversation; with no chat yet it is the
 * starting point for the one about to be created. The workspace default is
 * chosen in Settings, and every new chat already inherits it server-side.
 */
export function PerformanceSelector() {
  const [presets, setPresets] = React.useState<PresetOptionDto[]>([]);
  const [defaultPresetId, setDefaultPresetId] = React.useState<string | null>(null);
  const [defaultControls, setDefaultControls] = React.useState<{
    temperature: number;
    topP: number;
    maxTokens: number;
    thinkingBudget: number | null;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);

  const chatId = useChatStore((state) => state.chatId);
  const temperature = useChatStore((state) => state.chatTemperature);
  const topP = useChatStore((state) => state.chatTopP);
  const maxTokens = useChatStore((state) => state.chatMaxTokens);
  const thinkingBudget = useChatStore((state) => state.chatThinkingBudget);
  const updateChatSettings = useChatStore((state) => state.updateChatSettings);

  React.useEffect(() => {
    let cancelled = false;
    api
      .getDefaults()
      .then(({ defaults, presets: fetched }) => {
        if (cancelled) return;
        setPresets(fetched);
        setDefaultPresetId(defaults.presetId);
        setDefaultControls(defaults.controls);
      })
      .catch(() => {
        /* the button falls back to whatever the chat already has */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [updateChatSettings]);

  // A brand-new chat has no stored row yet, so seed the composer with the
  // workspace default. Re-runs when the user returns to "New chat", because
  // opening a new chat does not clear the previous chat's controls.
  React.useEffect(() => {
    if (!chatId && defaultControls) void updateChatSettings(defaultControls);
  }, [chatId, defaultControls, updateChatSettings]);

  const active =
    matchPreset(presets, { temperature, topP, maxTokens, thinkingBudget }) ??
    presets.find((preset) => preset.id === defaultPresetId) ??
    null;

  const choose = (preset: PresetOptionDto) => {
    void updateChatSettings({
      temperature: preset.temperature,
      topP: preset.topP,
      maxTokens: preset.maxTokens,
      thinkingBudget: preset.thinkingBudget ?? null,
    });
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="max-w-[10rem] gap-1.5 px-2"
              aria-label="Choose AI performance for this chat"
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : (
                <Gauge className="size-3.5 text-accent" />
              )}
              <span className="truncate text-xs">{active?.name ?? "Balanced"}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>AI performance for this chat</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>
          AI performance{chatId ? "" : " (for the new chat)"}
        </DropdownMenuLabel>
        {!presets.length ? (
          <p className="px-2 pb-2 text-xs text-muted-foreground">
            No presets available yet. Built-in levels load as soon as a provider is configured.
          </p>
        ) : (
          presets.map((preset) => (
            <DropdownMenuItem
              key={preset.id}
              onSelect={() => choose(preset)}
              className={cn("flex items-center gap-2", preset.id === active?.id && "text-accent")}
            >
              <Check
                className={cn("size-3.5 shrink-0", preset.id === active?.id ? "opacity-100" : "opacity-0")}
              />
              <span className="min-w-0 flex-1 truncate">
                {preset.name}
                {preset.builtin ? "" : " (saved)"}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {preset.thinkingBudget ? `think ${preset.thinkingBudget}` : `${Math.round(preset.maxTokens / 1000)}k out`}
              </span>
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />
        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Settings2 className="size-3.5" />
          Set the default in Settings
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}