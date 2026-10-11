"use client";

import * as React from "react";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRouter } from "next/navigation";
import { useUIStore } from "@/lib/store/ui-store";
import { useChatStore } from "@/lib/store/chat-store";
import { shortcutLabel } from "@/lib/utils";

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: "mod+k", label: "Search chats and messages" },
  { keys: "mod+shift+o", label: "New chat" },
  { keys: "mod+enter", label: "Send message" },
  { keys: "escape", label: "Stop generating" },
  { keys: "up", label: "Recall your last message in an empty composer" },
  { keys: "?", label: "Show this shortcut list" },
];

function formatKeys(keys: string): string {
  return shortcutLabel(keys.split("+").map((part) => (part === "escape" ? "Escape" : part === "up" ? "ArrowUp" : part)).join("+"));
}

/** Keyboard shortcut reference, opened with ? or the toolbar button. */
export function ShortcutsDialog() {
  const open = useUIStore((state) => state.shortcutsOpen);
  const setOpen = useUIStore((state) => state.setShortcutsOpen);
  const openChat = useChatStore((state) => state.openChat);
  const router = useRouter();

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void openChat(null);
        router.push("/");
        return;
      }
      if (event.key === "?" && !editing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openChat, router, setOpen]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Keyboard shortcuts"
            onClick={() => setOpen(true)}
          >
            <Keyboard className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Cmd is ⌘ on macOS and Ctrl elsewhere. Shortcuts never fire while you are typing in
              a text field, except for the ones that send or stop a message.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1.5">
            {SHORTCUTS.map((shortcut) => (
              <li key={shortcut.keys} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="text-muted-foreground">{shortcut.label}</span>
                <kbd className="rounded-md bg-secondary px-2 py-1 font-mono text-[11px] text-foreground">
                  {formatKeys(shortcut.keys)}
                </kbd>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}