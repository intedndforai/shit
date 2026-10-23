"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronRight,
  File as FileIcon,
  FileCode2,
  FolderClosed,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FilePreviewer, extensionOf, kindOf } from "@/components/files/file-previewer";
import {
  api,
  type WorkspaceFileDto,
  type WorkspaceNodeDto,
  type WorkspaceTreeDto,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * The code workspace.
 *
 * A local toolbox, not a chat: a file tree over the folder the coding tools are
 * pointed at, a text editor for the files in it, and a live preview that serves
 * the folder from `/api/workspace/preview/…` so a real multi-file site runs with
 * relative links, ES modules and images working.
 *
 * Saving is a direct user action and needs no approval; the server still applies
 * the same guards the model faces (nothing outside the root, secret-looking
 * names refused), so this cannot become a way around them.
 *
 * There is deliberately no in-browser TypeScript or bundler step. The preview
 * shows the files as the browser sees them, which is the honest thing for a
 * static site and avoids pretending to compile what it cannot.
 */

const PREVIEWABLE_PAGES = ["html", "htm", "svg", "md", "markdown"];

export function CodeWorkspace() {
  const [tree, setTree] = React.useState<WorkspaceTreeDto | null>(null);
  const [loadingTree, setLoadingTree] = React.useState(true);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [filter, setFilter] = React.useState("");

  const [openPath, setOpenPath] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<WorkspaceFileDto | null>(null);
  const [draft, setDraft] = React.useState("");
  const [dirty, setDirty] = React.useState(false);
  const [loadingFile, setLoadingFile] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState(true);
  const [previewKey, setPreviewKey] = React.useState(0);

  // `loadingTree` starts true for the first read, so this never has to set it
  // synchronously from an effect; the refresh button sets it from the handler.
  const loadTree = React.useEffectEvent(async () => {
    try {
      const result = await api.getWorkspaceTree({ depth: 4 });
      setTree(result);
      setExpanded((current) => {
        if (current.size) return current;
        // Open the first level so the folder is not a closed door.
        const first = result.nodes.find((node) => node.type === "directory");
        return new Set(first ? [first.path] : []);
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not read the workspace.");
    } finally {
      setLoadingTree(false);
    }
  });

  React.useEffect(() => {
    // The first read is inlined rather than delegated, so every setState here
    // happens after an await instead of synchronously inside the effect.
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.getWorkspaceTree({ depth: 4 });
        if (cancelled) return;
        setTree(result);
        setExpanded((current) => {
          if (current.size) return current;
          const first = result.nodes.find((node) => node.type === "directory");
          return new Set(first ? [first.path] : []);
        });
      } catch (cause) {
        if (!cancelled)
          toast.error(cause instanceof Error ? cause.message : "Could not read the workspace.");
      } finally {
        if (!cancelled) setLoadingTree(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openFile = React.useEffectEvent(async (path: string) => {
    setOpenPath(path);
    setLoadingFile(true);
    setFileError(null);
    try {
      const result = await api.readWorkspaceFile(path);
      setFile(result.file);
      setDraft(result.file.content);
      setDirty(false);
    } catch (cause) {
      setFile(null);
      setFileError(cause instanceof Error ? cause.message : "Could not read that file.");
    } finally {
      setLoadingFile(false);
    }
  });

  const save = React.useEffectEvent(async () => {
    if (!openPath || !file || file.binary || file.tooLarge) return;
    setSaving(true);
    try {
      const result = await api.writeWorkspaceFile({ path: openPath, content: draft });
      setFile({
        ...file,
        content: draft,
        bytes: result.file.bytes,
        lines: draft.split(/\r?\n/).length,
      });
      setDirty(false);
      setPreviewKey((key) => key + 1);
      toast.success(`${result.file.created ? "Created" : "Saved"} ${result.file.path}`);
      void loadTree();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  });

  // Ctrl/Cmd+S saves without leaving the editor.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty]);

  const nodes = React.useMemo(() => tree?.nodes ?? [], [tree]);
  const visible = React.useMemo(
    () =>
      filter
        ? nodes.filter((node) => node.path.toLowerCase().includes(filter.toLowerCase()))
        : nodes,
    [nodes, filter]
  );

  const toggleDir = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  /* ---------------------------------------------------------------- */
  /* Setup states                                                     */
  /* ---------------------------------------------------------------- */

  if (loadingTree && !tree) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Reading the workspace…
      </div>
    );
  }

  if (tree && !tree.status.enabled) {
    return (
      <SetupState
        title="The coding workspace is switched off"
        body="Conduit will only let you browse and edit a folder once you name it. Turn it on in Settings → Tools, point it at a project folder, then come back."
      />
    );
  }

  if (tree && tree.status.enabled && !tree.status.exists) {
    return (
      <SetupState
        title="That folder does not exist yet"
        body={`The workspace is set to ${tree.status.root}, which is not on disk. Create it, or change the folder in Settings → Tools.`}
      />
    );
  }

  /* ---------------------------------------------------------------- */
  /* Main view                                                        */
  /* ---------------------------------------------------------------- */

  const previewPath =
    openPath && PREVIEWABLE_PAGES.includes(extensionOf(openPath)) ? openPath : findEntry(nodes);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <FileCode2 className="size-4 text-accent" />
        <span className="text-sm font-medium">Code workspace</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {tree?.status.root}
        </span>
        {tree?.status.allowCommands ? (
          <span className="rounded-full border border-border px-1.5 text-[10px] uppercase text-muted-foreground">
            commands on
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Switch
              checked={previewOpen}
              onCheckedChange={setPreviewOpen}
              aria-label="Show the live preview"
            />
            Preview
          </label>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reload file tree"
            onClick={() => {
              setLoadingTree(true);
              void loadTree();
            }}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/settings">
              <Settings2 className="size-3.5" />
              Settings
            </Link>
          </Button>
        </div>
      </div>

      {tree?.note ? (
        <p className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-3.5" /> {tree.note}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* File tree */}
        <div className="flex w-64 shrink-0 flex-col border-r border-border">
          <div className="border-b border-border p-2">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter files…"
              aria-label="Filter files"
              className="h-7 text-xs"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-1">
            {!visible.length ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                {nodes.length
                  ? "Nothing matches that filter."
                  : "This folder is empty. Ask the model to build something here, or save a file from the preview."}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {visible.map((node) => (
                  <TreeNode
                    key={node.path}
                    node={node}
                    depth={0}
                    expanded={expanded}
                    onToggle={toggleDir}
                    activePath={openPath}
                    onOpen={(path) => void openFile(path)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-border">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
            <span className="truncate font-mono text-muted-foreground">
              {openPath ?? "No file open"}
            </span>
            {dirty ? (
              <span className="rounded-full bg-accent/15 px-1.5 text-[10px] text-accent-foreground">
                unsaved
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              {previewPath ? (
                <Button variant="ghost" size="sm" onClick={() => setPreviewKey((key) => key + 1)}>
                  <Play className="size-3.5" />
                  Reload preview
                </Button>
              ) : null}
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={!dirty || saving || !file || file.binary || file.tooLarge}
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {fileError ? (
              <p className="p-3 text-xs text-destructive">{fileError}</p>
            ) : loadingFile ? (
              <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Opening…
              </p>
            ) : !file ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
                Pick a file on the left to edit it. Saving writes straight to disk — Conduit keeps a
                copy of nothing.
              </div>
            ) : file.tooLarge ? (
              <p className="p-3 text-xs text-muted-foreground">
                This file is {(file.bytes / 1024 / 1024).toFixed(1)} MB, past the editor limit. Open
                it in your own editor.
              </p>
            ) : file.binary ? (
              <div className="h-full p-3">
                <FilePreviewer
                  source={{
                    name: file.path,
                    url: `/api/workspace/preview/${file.path.split("/").map(encodeURIComponent).join("/")}`,
                    bytes: file.bytes,
                  }}
                  className="h-full"
                />
              </div>
            ) : (
              <textarea
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setDirty(event.target.value !== (file?.content ?? ""));
                }}
                spellCheck={false}
                aria-label={`Edit ${file.path}`}
                className="h-full w-full resize-none bg-background p-3 font-mono text-[12px] leading-relaxed outline-none"
              />
            )}
          </div>
        </div>

        {/* Preview */}
        {previewOpen ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
              <span className="truncate font-mono">{previewPath ?? "nothing to preview"}</span>
              {previewPath ? (
                <Button variant="ghost" size="sm" className="ml-auto" asChild>
                  <a
                    href={`/api/workspace/preview/${previewPath.split("/").map(encodeURIComponent).join("/")}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open in a new tab
                  </a>
                </Button>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 bg-secondary/30 p-2">
              {previewPath ? (
                kindOf(previewPath) === "markdown" ? (
                  <div className="h-full overflow-auto rounded-lg border border-border bg-background p-3">
                    <FilePreviewer
                      source={{
                        name: previewPath,
                        url: `/api/workspace/preview/${previewPath.split("/").map(encodeURIComponent).join("/")}?v=${previewKey}`,
                      }}
                      className="h-full"
                    />
                  </div>
                ) : (
                  <iframe
                    key={`${previewPath}:${previewKey}`}
                    title={`Preview of ${previewPath}`}
                    sandbox="allow-scripts allow-forms allow-modals allow-popups"
                    src={`/api/workspace/preview/${previewPath.split("/").map(encodeURIComponent).join("/")}?v=${previewKey}`}
                    className="h-full w-full rounded-lg border border-border bg-white"
                  />
                )
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
                  Open an HTML, SVG or Markdown file, or add an{" "}
                  <code className="mx-1 rounded bg-secondary px-1">index.html</code> to the folder,
                  and it will preview here with real links, styles and scripts.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** `index.html` at the shallowest depth, or the first page in the tree. */
function findEntry(nodes: readonly WorkspaceNodeDto[]): string | null {
  const files = nodes.filter((node) => node.type === "file");
  const index = files.find((node) => /(^|\/)index\.html?$/i.test(node.path));
  if (index) return index.path;
  const shallowest = files
    .filter((node) => ["html", "htm", "svg", "md"].includes(extensionOf(node.path)))
    .sort((left, right) => left.path.split("/").length - right.path.split("/").length);
  return shallowest[0]?.path ?? null;
}

function TreeNode({
  node,
  depth,
  expanded,
  onToggle,
  activePath,
  onOpen,
}: {
  node: WorkspaceNodeDto;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  activePath: string | null;
  onOpen: (path: string) => void;
}) {
  const isDirectory = node.type === "directory";
  const isOpen = expanded.has(node.path);

  return (
    <li>
      <button
        type="button"
        onClick={() => (isDirectory ? onToggle(node.path) : onOpen(node.path))}
        aria-expanded={isDirectory ? isOpen : undefined}
        className={cn(
          "flex w-full items-center gap-1 rounded-md py-0.5 pr-1 text-left text-xs transition-colors",
          node.path === activePath ? "bg-secondary" : "hover:bg-secondary/60"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {isDirectory ? (
          <>
            <ChevronRight
              className={cn("size-3 shrink-0 transition-transform", isOpen && "rotate-90")}
            />
            {isOpen ? (
              <FolderOpen className="size-3.5 shrink-0 text-accent" />
            ) : (
              <FolderClosed className="size-3.5 shrink-0 text-muted-foreground" />
            )}
          </>
        ) : (
          <>
            <span className="size-3 shrink-0" />
            <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  );
}

function SetupState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <FileCode2 className="size-6 text-muted-foreground" />
      <h1 className="text-base font-medium">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      <Button asChild>
        <Link href="/settings">Open Settings → Tools</Link>
      </Button>
    </div>
  );
}
