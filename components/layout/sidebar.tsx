"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Archive,
  Blocks,
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
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/search", label: "Search", icon: Search, shortcut: "Ctrl+K" },
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
  const active = item.href === "/" ? pathname === "/" || pathname.startsWith("/chat") : pathname === item.href;

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm text-sidebar-foreground/80 transition-colors",
        "hover:bg-secondary/70 hover:text-sidebar-foreground",
        active && "bg-secondary font-medium text-sidebar-foreground",
        collapsed && "justify-center px-0"
      )}
    >
      <item.icon className="size-4 shrink-0" />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
      {!collapsed && item.shortcut ? (
        <span className="ml-auto text-[11px] text-muted-foreground">{item.shortcut}</span>
      ) : null}
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

/** Chat history list with pin, rename, and delete actions. */
function ChatList({ onNavigate }: { onNavigate?: () => void }) {
  const chats = useChatStore((state) => state.chats);
  const currentId = useChatStore((state) => state.chatId);
  const togglePin = useChatStore((state) => state.togglePin);
  const removeChat = useChatStore((state) => state.removeChat);
  const renameChat = useChatStore((state) => state.renameChat);
  const [renaming, setRenaming] = React.useState<{ id: string; title: string } | null>(null);

  const active = chats.filter((chat) => !chat.archived);
  if (!active.length) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No chats yet.</p>;
  }

  const pinned = active.filter((chat) => chat.pinned);
  const rest = active.filter((chat) => !chat.pinned);

  const renderChat = (chat: (typeof active)[number]) => (
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
        <span className="truncate">{chat.title ?? "New chat"}</span>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => void removeChat(chat.id)}>
            <Trash2 className="size-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <>
      <div className="flex flex-col gap-0.5 px-1">
        {pinned.length ? (
          <>
            <p className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">Pinned</p>
            {pinned.map(renderChat)}
          </>
        ) : null}
        {rest.length ? (
          <>
            {pinned.length ? (
              <p className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">Recent</p>
            ) : null}
            {rest.map(renderChat)}
          </>
        ) : null}
      </div>

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
          <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} />
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