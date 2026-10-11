"use client";

import * as React from "react";
import { Settings2, Wrench } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, type ToolSpecDto } from "@/lib/api-client";
import { useChatStore } from "@/lib/store/chat-store";
import { useUIStore } from "@/lib/store/ui-store";

/**
 * Per-conversation tool switch. The selection is stored on the chat (and sent
 * with the next turn), so different chats can use different tools.
 */
export function ToolsMenu() {
  const [specs, setSpecs] = React.useState<ToolSpecDto[]>([]);
  const pendingTools = useUIStore((state) => state.pendingTools);
  const setPendingTools = useUIStore((state) => state.setPendingTools);
  const chatId = useChatStore((state) => state.chatId);

  React.useEffect(() => {
    let cancelled = false;
    api
      .getTools()
      .then((state) => {
        if (!cancelled) setSpecs(state.specs);
      })
      .catch(() => {
        /* the menu simply stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const defaults = specs.filter((spec) => spec.defaultEnabled && spec.configured).map((spec) => spec.name);
  const enabled = new Set(pendingTools ?? defaults);
  const usable = specs.filter((spec) => spec.configured);

  const toggle = (name: string, next: boolean) => {
    const updated = new Set(enabled);
    if (next) updated.add(name);
    else updated.delete(name);
    const list = [...updated];

    setPendingTools(list);
    if (chatId) void api.updateChat(chatId, { toolsEnabled: list });
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Choose tools">
              <Wrench className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Tools the model may use in this chat</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" className="w-72">
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Tools for this chat</p>
        {!usable.length ? (
          <p className="px-2 pb-2 text-xs text-muted-foreground">
            No tools are configured yet. Add a search provider in Settings.
          </p>
        ) : (
          usable.map((spec) => (
            <DropdownMenuCheckboxItem
              key={spec.name}
              checked={enabled.has(spec.name)}
              onCheckedChange={(next) => toggle(spec.name, next === true)}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-sm">
                  {spec.label}
                  {spec.source !== "builtin" ? (
                    <span className="rounded bg-secondary px-1 text-[10px] uppercase text-muted-foreground">
                      {spec.source === "mcp" ? (spec.server ?? "MCP") : "custom"}
                    </span>
                  ) : null}
                </span>
                <span className="line-clamp-2 text-[11px] text-muted-foreground">{spec.description}</span>
              </span>
            </DropdownMenuCheckboxItem>
          ))
        )}

        {specs.some((spec) => !spec.configured) ? (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1 text-[11px] text-muted-foreground">
              {specs
                .filter((spec) => !spec.configured)
                .map((spec) => spec.label)
                .join(", ")}{" "}
              need configuration.
            </p>
          </>
        ) : null}

        <DropdownMenuSeparator />
        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Settings2 className="size-3.5" /> Configure tools
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}