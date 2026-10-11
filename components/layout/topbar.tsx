"use client";

import * as React from "react";
import { Check, Menu, PanelRight, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUIStore } from "@/lib/store/ui-store";
import { useChatStore } from "@/lib/store/chat-store";
import { useRouter } from "next/navigation";

export function Topbar() {
  const setMobileNavOpen = useUIStore((state) => state.setMobileNavOpen);
  const artifactsOpen = useUIStore((state) => state.artifactsOpen);
  const toggleArtifacts = useUIStore((state) => state.toggleArtifacts);
  const router = useRouter();

  const chatId = useChatStore((state) => state.chatId);
  const chatTitle = useChatStore((state) => state.chatTitle);
  const chatModelLabel = useChatStore((state) => state.chatModelLabel);
  const chatArchived = useChatStore((state) => state.chatArchived);
  const renameChat = useChatStore((state) => state.renameChat);
  const openChat = useChatStore((state) => state.openChat);

  // Which chat the inline rename belongs to — switching chats simply makes it
  // no longer match, so no reset effect is needed.
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const editing = Boolean(chatId) && editingId === chatId;

  const stopEditing = () => setEditingId(null);

  const save = () => {
    if (!chatId) return;
    const next = draft.trim();
    stopEditing();
    if (next && next !== (chatTitle ?? "")) void renameChat(chatId, next);
  };

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

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {chatId && editing ? (
          <div className="flex min-w-0 items-center gap-1">
            <Input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") save();
                if (event.key === "Escape") stopEditing();
              }}
              className="h-8 max-w-sm text-sm"
              aria-label="Chat title"
            />
            <Button variant="ghost" size="icon-sm" aria-label="Save title" onClick={save}>
              <Check className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Cancel rename" onClick={stopEditing}>
              <X className="size-4" />
            </Button>
          </div>
        ) : chatId ? (
          <button
            type="button"
            onClick={() => {
              if (!chatId) return;
              setDraft(chatTitle ?? "");
              setEditingId(chatId);
            }}
            className="group flex min-w-0 max-w-sm items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium transition-colors hover:bg-secondary"
            title="Rename chat"
          >
            <span className="truncate">{chatTitle ?? "New chat"}</span>
            <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ) : (
          <span className="px-2 text-sm font-medium text-muted-foreground">New chat</span>
        )}

        {chatId ? (
          <Badge variant="outline" className="hidden max-w-[16rem] truncate lg:inline-flex">
            {chatModelLabel ?? "No model"}
          </Badge>
        ) : (
          <Badge variant="outline" className="hidden lg:inline-flex">
            Provider-agnostic
          </Badge>
        )}
        {chatArchived ? (
          <Badge variant="warning" className="hidden sm:inline-flex">
            Archived
          </Badge>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={artifactsOpen ? "Hide artifacts panel" : "Show artifacts panel"}
              aria-pressed={artifactsOpen}
              onClick={toggleArtifacts}
              className="hidden sm:inline-flex"
            >
              <PanelRight className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Artifacts captured from this chat</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New chat"
              className="md:hidden"
              onClick={() => {
                void openChat(null);
                router.push("/");
              }}
            >
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