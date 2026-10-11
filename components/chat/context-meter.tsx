"use client";

import * as React from "react";
import { Gauge, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { estimateContentTokens, estimateCost, estimateTokens, formatTokens } from "@/lib/tokens";
import { useChatStore } from "@/lib/store/chat-store";
import { cn } from "@/lib/utils";

/**
 * Live context meter: estimates how much of the model's window the active
 * transcript occupies, what the conversation has cost so far, and offers to
 * compress the oldest turns when the window gets tight.
 */
export function ContextMeter() {
  const chatId = useChatStore((state) => state.chatId);
  const messages = useChatStore((state) => state.messages);
  const contextWindow = useChatStore((state) => state.chatContextWindow);
  const pricing = useChatStore((state) => state.chatPricing);
  const systemPrompt = useChatStore((state) => state.chatSystemPrompt);
  const streaming = useChatStore((state) => state.streaming);
  const summarize = useChatStore((state) => state.summarize);

  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const stats = React.useMemo(() => {
    let tokens = estimateTokens(systemPrompt ?? "");
    let promptTokens = 0;
    let completionTokens = 0;
    for (const message of messages) {
      tokens += estimateContentTokens(message.content);
      promptTokens += message.usage?.promptTokens ?? 0;
      completionTokens += message.usage?.completionTokens ?? 0;
    }
    const reported = messages.reduce((total, message) => total + (message.cost ?? 0), 0);
    const estimated = estimateCost(promptTokens, completionTokens, pricing.input, pricing.output);
    return { tokens, cost: reported > 0 ? reported : estimated, reported };
  }, [messages, pricing.input, pricing.output, systemPrompt]);

  const share = contextWindow > 0 ? Math.min(1, stats.tokens / contextWindow) : 0;
  const percent = Math.round(share * 100);
  const tone = percent >= 90 ? "destructive" : percent >= 70 ? "warning" : "calm";

  const compress = async () => {
    setBusy(true);
    const result = await summarize("auto");
    setBusy(false);
    setNote(result ?? "Nothing to compress yet.");
  };

  if (!chatId || !messages.length) return null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-1.5">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Gauge className="size-3.5 shrink-0" />
        <span className="whitespace-nowrap">
          ≈{formatTokens(stats.tokens)} / {formatTokens(contextWindow)} tokens
        </span>

        <div className="relative h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-secondary">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              tone === "destructive" ? "bg-destructive" : tone === "warning" ? "bg-amber-500" : "bg-accent"
            )}
            style={{ width: `${Math.max(2, percent)}%` }}
          />
        </div>

        <span className="whitespace-nowrap">{percent}%</span>

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex cursor-help items-center gap-1 whitespace-nowrap">
              <Info className="size-3" />
              {stats.cost > 0 ? `$${stats.cost.toFixed(4)}` : "cost unknown"}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {stats.reported > 0
              ? "Cost reported by the provider's usage for this conversation."
              : "Estimated from the configured price per million tokens and the token counts the provider reported."}
          </TooltipContent>
        </Tooltip>

        {percent >= 70 || note ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={busy || streaming}
            onClick={() => void compress()}
            title="Summarize or trim the oldest turns to free context"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : null}
            Free context
          </Button>
        ) : null}
      </div>
      {note ? <p className="pt-1 text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}
