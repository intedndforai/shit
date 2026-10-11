"use client";

import * as React from "react";
import Link from "next/link";
import { EyeOff, FolderKanban, Type } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, type ProjectDto, type StyleDto } from "@/lib/api-client";
import { useChatStore } from "@/lib/store/chat-store";

const SELECT_CLASS =
  "h-7 rounded-md border border-border bg-background px-1.5 text-xs outline-none focus-visible:border-accent/70";

/**
 * Per-chat context controls: which project's knowledge base this chat can read,
 * which response style to apply, and whether the chat is incognito.
 */
export function ChatContextBar() {
  const chatId = useChatStore((state) => state.chatId);
  const projectId = useChatStore((state) => state.chatProjectId);
  const styleId = useChatStore((state) => state.chatStyleId);
  const incognito = useChatStore((state) => state.chatIncognito);
  const updateChatMeta = useChatStore((state) => state.updateChatMeta);

  const [projects, setProjects] = React.useState<ProjectDto[]>([]);
  const [styles, setStyles] = React.useState<StyleDto[]>([]);

  React.useEffect(() => {
    if (!chatId) return;
    let cancelled = false;
    Promise.all([api.listProjects(), api.listStyles()])
      .then(([projectResult, styleResult]) => {
        if (cancelled) return;
        setProjects(projectResult.projects);
        setStyles(styleResult.styles);
      })
      .catch(() => {
        /* the bar simply shows no options if this fails */
      });
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  if (!chatId) return null;

  const activeProject = projects.find((project) => project.id === projectId) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pb-2 text-xs text-muted-foreground">
      <label className="flex min-w-0 items-center gap-1.5">
        <FolderKanban className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">Project</span>
        <select
          className={SELECT_CLASS}
          value={projectId ?? ""}
          onChange={(event) => void updateChatMeta({ projectId: event.target.value || null })}
        >
          <option value="">No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>

      {activeProject ? (
        <Link href={`/projects/${activeProject.id}`} className="underline hover:text-foreground">
          {activeProject.fileCount} file{activeProject.fileCount === 1 ? "" : "s"} in the knowledge base
        </Link>
      ) : null}

      <label className="flex min-w-0 items-center gap-1.5">
        <Type className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">Response style</span>
        <select
          className={SELECT_CLASS}
          value={styleId ?? ""}
          onChange={(event) => void updateChatMeta({ styleId: event.target.value || null })}
        >
          <option value="">Default style</option>
          {styles.map((style) => (
            <option key={style.id} value={style.id}>
              {style.name}
            </option>
          ))}
        </select>
      </label>

      <Tooltip>
        <TooltipTrigger asChild>
          <label className="ml-auto flex items-center gap-1.5">
            <EyeOff className="size-3.5" aria-hidden />
            Incognito
            <Switch
              checked={incognito}
              onCheckedChange={(next) => void updateChatMeta({ incognito: next })}
              aria-label="Incognito chat"
            />
          </label>
        </TooltipTrigger>
        <TooltipContent>
          Incognito chats are never written to the database: no history, no memory, and no titles.
        </TooltipContent>
      </Tooltip>
    </div>
  );
}