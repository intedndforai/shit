"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Archive,
  ArchiveRestore,
  Blocks,
  ChevronRight,
  Download,
  FileJson,
  FolderKanban,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  Waypoints,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUIStore } from "@/lib/store/ui-store";
import { useChatStore } from "@/lib/store/chat-store";
import { api, type ChatSummary } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type NavItem = {
  href?: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  action?: "search";
};

const NAV_ITEMS: NavItem[] = [
  { label: "Search", icon: Search, shortcut: "Ctrl+K", action: "search" },
  { href: "/", label: "Chats", icon: MessageSquare },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/artifacts", label: "Artifacts", icon: Blocks },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function BrandMark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-sidebar-foreground transition-colors hover:bg-secondary/60"
      aria-label="Conduit home"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Waypoints className="size-4" />
      </span>
      {!collapsed ? (
        <span className="font-serif text-lg font-medium tracking-tight">Conduit</span>
      ) : null}
    </Link>
  );
}

function NavLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const setSearchOpen = useUIStore((state) => state.setSearchOpen);
  const active = item.href ? (item.href === "/" ? pathname === "/" || pathname.startsWith("/chat") : pathname === item.href) : false;

  const className = cn(
    "group flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-sm text-sidebar-foreground/80 transition-colors",
    "hover:bg-secondary/70 hover:text-sidebar-foreground",
    active && "bg-secondary font-medium text-sidebar-foreground",
    collapsed && "justify-center px-0"
  );

  const content = (
    <>
      <item.icon className="size-4 shrink-0" />
      {!collapsed ? <span className="truncate text-left">{item.label}</span> : null}
      {!collapsed && item.shortcut ? (
        <span className="ml-auto text-[11px] text-muted-foreground">{item.shortcut}</span>
      ) : null}
    </>
  );

  const link = item.action === "search" ? (
    <button
      type="button"
      className={className}
      onClick={() => {
        setSearchOpen(true);
        onNavigate?.();
      }}
    >
      {content}
    </button>
  ) : (
    <Link href={item.href ?? "/"} onClick={onNavigate} aria-current={active ? "page" : undefined} className={className}>
      {content}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function NewChatButton({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const router = useRouter();
  const openChat = useChatStore((state) => state.openChat);

  const start = () => {
    void openChat(null);
    onNavigate?.();
    router.push("/");
    requestAnimationFrame(() => document.getElementById("composer")?.focus());
  };

  const button = (
    <Button
      variant="accent"
      onClick={start}
      className={cn("w-full justify-center gap-2", collapsed && "px-0")}
    >
      <Plus className="size-4" />
      {!collapsed ? "New chat" : null}
    </Button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">New chat</TooltipContent>
    </Tooltip>
  );
}

function downloadChat(chatId: string, format: "md" | "json") {
  const anchor = document.createElement("a");
  anchor.href = api.exportUrl(chatId, format);
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Chat history list with pin, rename, archive, export, and import actions. */
function ChatList({ onNavigate }: { onNavigate?: () => void }) {
  const chats = useChatStore((state) => state.chats);
  const currentId = useChatStore((state) => state.chatId);
  const togglePin = useChatStore((state) => state.togglePin);
  const toggleArchive = useChatStore((state) => state.toggleArchive);
  const removeChat = useChatStore((state) => state.removeChat);
  const renameChat = useChatStore((state) => state.renameChat);
  const loadChats = useChatStore((state) => state.loadChats);
  const openChat = useChatStore((state) => state.openChat);

  const router = useRouter();
  const [renaming, setRenaming] = React.useState<{ id: string; title: string } | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const activeChats = chats.filter((chat) => !chat.archived);
  const archivedChats = chats.filter((chat) => chat.archived);

  const importChat = async (file: File) => {
    setImportError(null);
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const result = await api.importChat(payload);
      await loadChats();
      await openChat(result.chatId);
      onNavigate?.();
      router.push(`/chat/${result.chatId}`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import that file.");
    }
  };

  const renderChat = (chat: ChatSummary) => (
    <div key={chat.id} className="group/chat relative flex items-center">
      <Link
        href={`/chat/${chat.id}`}
        onClick={onNavigate}
        className={cn(
          "flex h-9 min-w-0 flex-1 items-center rounded-lg px-2.5 pr-8 text-sm text-sidebar-foreground/80 transition-colors",
          "hover:bg-secondary/70 hover:text-sidebar-foreground",
          currentId === chat.id && "bg-secondary font-medium text-sidebar-foreground"
        )}
        title={chat.title ?? "New chat"}
      >
        <span className={cn("truncate", chat.archived && "text-muted-foreground")}>{chat.title ?? "New chat"}</span>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${chat.title ?? "chat"}`}
            className="absolute right-1 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary focus:opacity-100 group-hover/chat:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setRenaming({ id: chat.id, title: chat.title ?? "" })}>
            <Pencil className="size-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void togglePin(chat.id)}>
            {chat.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            {chat.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void toggleArchive(chat.id)}>
            {chat.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
            {chat.archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => downloadChat(chat.id, "md")}>
            <Download className="size-3.5" /> Export as Markdown
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => downloadChat(chat.id, "json")}>
            <FileJson className="size-3.5" /> Export as JSON
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => void removeChat(chat.id)}>
            <Trash2 className="size-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const pinned = activeChats.filter((chat) => chat.pinned);
  const rest = activeChats.filter((chat) => !chat.pinned);

  return (
    <>
      <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
        <p className="text-xs font-medium text-muted-foreground">Chat history</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Import a chat from JSON"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Upload className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Import chat (JSON)</TooltipContent>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importChat(file);
          }}
        />
      </div>

      {importError ? <p className="px-2.5 pb-1 text-[11px] text-destructive">{importError}</p> : null}

      {!activeChats.length ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No chats yet.</p>
      ) : (
        <div className="flex flex-col gap-0.5 px-1">
          {pinned.length ? (
            <>
              <p className="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Pinned
              </p>
              {pinned.map(renderChat)}
            </>
          ) : null}
          {rest.length ? (
            <>
              {pinned.length ? (
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Recent
                </p>
              ) : null}
              {rest.map(renderChat)}
            </>
          ) : null}
        </div>
      )}

      {archivedChats.length ? (
        <div className="mt-1 px-1">
          <button
            type="button"
            onClick={() => setShowArchived((value) => !value)}
            aria-expanded={showArchived}
            className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-secondary/60"
          >
            <ChevronRight className={cn("size-3 transition-transform", showArchived && "rotate-90")} />
            Archived ({archivedChats.length})
          </button>
          {showArchived ? <div className="flex flex-col gap-0.5">{archivedChats.map(renderChat)}</div> : null}
        </div>
      ) : null}

      <Dialog open={Boolean(renaming)} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renaming?.title ?? ""}
            onChange={(event) =>
              setRenaming((current) => (current ? { ...current, title: event.target.value } : current))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && renaming) {
                void renameChat(renaming.id, renaming.title);
                setRenaming(null);
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (renaming) void renameChat(renaming.id, renaming.title);
                setRenaming(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Shared navigation body used by both the desktop rail and the mobile drawer. */
export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const loadChats = useChatStore((state) => state.loadChats);

  React.useEffect(() => {
    void loadChats();
  }, [loadChats]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between px-1")}>
        <BrandMark collapsed={collapsed} />
      </div>

      <div className={cn(collapsed ? "px-1.5" : "px-1")}>
        <NewChatButton collapsed={collapsed} onNavigate={onNavigate} />
      </div>

      <nav className={cn("flex flex-col gap-0.5", collapsed ? "px-1.5" : "px-1")} aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.label} item={item} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </nav>

      {!collapsed ? (
        <>
          <Separator className="mx-1" />
          <ScrollArea className="min-h-0 flex-1">
            <ChatList onNavigate={onNavigate} />
          </ScrollArea>
        </>
      ) : (
        <div className="flex-1" />
      )}

      <Separator className="mx-1" />

      <div className={cn("flex items-center gap-2 p-1", collapsed ? "justify-center" : "")}>
        <Avatar className="size-7">
          <AvatarFallback>L</AvatarFallback>
        </Avatar>
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Local user</p>
            <p className="truncate text-[11px] text-muted-foreground">Single-user mode</p>
          </div>
        ) : null}
        {!collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/artifacts"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="Artifact library"
              >
                <Archive className="size-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>Artifact library</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

/** Desktop sidebar with a collapsible rail. */
export function Sidebar() {
  const collapsed = useUIStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 68 : 264 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="hidden shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col"
      aria-label="Sidebar"
    >
      <div className="flex h-full flex-col p-2">
        <div className="flex min-h-0 flex-1 flex-col">
          <SidebarNav collapsed={collapsed} />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleSidebar}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn("mt-2", collapsed ? "self-center" : "self-end")}
            >
              <ToggleIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{collapsed ? "Expand" : "Collapse"} sidebar</TooltipContent>
        </Tooltip>
      </div>
    </motion.aside>
  );
}