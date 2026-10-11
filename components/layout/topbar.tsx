"use client";

import { ChevronDown, Menu, PanelRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUIStore } from "@/lib/store/ui-store";

export function Topbar() {
  const setMobileNavOpen = useUIStore((state) => state.setMobileNavOpen);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md">
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        aria-label="Open navigation"
        onClick={() => setMobileNavOpen(true)}
      >
        <Menu className="size-4" />
      </Button>

      <div
        className="flex h-8 items-center gap-2 rounded-lg border border-border px-2.5 text-sm text-muted-foreground"
        title="Model selection arrives with the provider layer (Milestone 2)"
      >
        <span className="hidden sm:inline">Model</span>
        <span className="font-medium text-foreground">No model connected</span>
        <ChevronDown className="size-3.5" />
      </div>

      <Badge variant="outline" className="hidden lg:inline-flex">
        Provider-agnostic
      </Badge>

      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Artifacts panel"
              disabled
              className="hidden sm:inline-flex"
            >
              <PanelRight className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Artifacts panel (Milestone 5)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="New chat" className="md:hidden">
              <Plus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New chat</TooltipContent>
        </Tooltip>

        <ThemeToggle />
      </div>
    </header>
  );
}