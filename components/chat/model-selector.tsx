"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Loader2, Settings2, Sparkles } from "lucide-react";
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
import { api, type ModelOptionDto } from "@/lib/api-client";
import { useChatStore } from "@/lib/store/chat-store";
import { useUIStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

/**
 * In-chat model selector.
 *
 * Choosing a model here pins it to the conversation, so this turn and every
 * later turn run on it. The `@` picker in the composer still switches one turn
 * only; the selector shows that pending choice as active until it is sent.
 */
export function ModelSelector() {
  const [models, setModels] = React.useState<ModelOptionDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const chatId = useChatStore((state) => state.chatId);
  const chatModelId = useChatStore((state) => state.chatModelId);
  const updateChatMeta = useChatStore((state) => state.updateChatMeta);
  const pendingModelId = useUIStore((state) => state.pendingModelId);
  const setPendingModelId = useUIStore((state) => state.setPendingModelId);

  React.useEffect(() => {
    let cancelled = false;
    api
      .listAllModels()
      .then(({ models: fetched }) => {
        if (!cancelled) setModels(fetched);
      })
      .catch(() => {
        /* the menu just stays empty */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeId = pendingModelId ?? chatModelId;
  const active =
    models.find((model) => model.id === activeId) ??
    models.find((model) => model.isDefault) ??
    models.find((model) => model.isFallback) ??
    models[0] ??
    null;

  const grouped = React.useMemo(() => {
    const byProvider = new Map<string, ModelOptionDto[]>();
    for (const model of models) {
      const list = byProvider.get(model.providerName) ?? [];
      list.push(model);
      byProvider.set(model.providerName, list);
    }
    return [...byProvider.entries()];
  }, [models]);

  const choose = (model: ModelOptionDto) => {
    setPendingModelId(null);
    // A chat that does not exist yet keeps the choice for its first turn.
    if (!chatId) {
      setPendingModelId(model.id);
      return;
    }
    void updateChatMeta({ modelId: model.id });
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 max-w-[12rem] gap-1.5 px-2"
              aria-label="Choose the model for this chat"
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : (
                <Sparkles className="size-3.5 text-accent" />
              )}
              <span className="truncate text-xs">
                {active ? active.displayName ?? active.externalId : "No model"}
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Model for this chat</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Model for this chat</DropdownMenuLabel>
        {!models.length ? (
          <p className="px-2 pb-2 text-xs text-muted-foreground">
            No models yet. Add a provider and discover its models in Settings first.
          </p>
        ) : (
          grouped.map(([providerName, entries]) => (
            <React.Fragment key={providerName}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] tracking-wide text-muted-foreground uppercase">
                {providerName}
              </DropdownMenuLabel>
              {entries.map((model) => (
                <DropdownMenuItem
                  key={model.id}
                  onSelect={() => choose(model)}
                  className={cn("flex items-center gap-2", model.id === active?.id && "text-accent")}
                >
                  <Check className={cn("size-3.5 shrink-0", model.id === active?.id ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{model.displayName ?? model.externalId}</span>
                  {model.contextWindow ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {Math.round(model.contextWindow / 1000)}k
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </React.Fragment>
          ))
        )}

        <DropdownMenuSeparator />
        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Settings2 className="size-3.5" />
          Manage models
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}