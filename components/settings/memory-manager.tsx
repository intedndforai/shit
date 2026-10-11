"use client";

import * as React from "react";
import { BrainCircuit, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, type MemoryDto } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/utils";

/**
 * Cross-chat memory. When it is on, the model can propose facts with a
 * <memory> block and they are recalled (keyword-ranked) in later chats.
 * Incognito chats never read or write memory.
 */
export function MemoryManager() {
  const [enabled, setEnabled] = React.useState(false);
  const [memories, setMemories] = React.useState<MemoryDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [editing, setEditing] = React.useState<{ id: string; content: string } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .getMemory()
      .then((state) => {
        if (cancelled) return;
        setEnabled(state.enabled);
        setMemories(state.memories);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load memory.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (next: boolean) => {
    setEnabled(next);
    setBusy(true);
    setError(null);
    try {
      const state = await api.setMemoryEnabled(next);
      setEnabled(state.enabled);
      setMemories(state.memories);
    } catch (cause) {
      setEnabled(!next);
      setError(cause instanceof Error ? cause.message : "Could not change the memory setting.");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const content = draft.trim();
    if (content.length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.addMemory(content);
      setMemories(result.memories);
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that memory.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.updateMemory(editing.id, editing.content);
      setMemories(result.memories);
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update that memory.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.deleteMemory(id);
      setMemories(result.memories);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete that memory.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrainCircuit className="size-4 text-accent" />
          Memory
        </CardTitle>
        <CardDescription>
          Let the assistant remember facts across chats. Everything here stays on this machine and can
          be edited or deleted at any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Remember across chats</p>
            <p className="text-xs text-muted-foreground">
              Uses a <code className="font-mono">&lt;memory&gt;</code> block the model can emit, or facts
              you add below.
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={busy || loading}
            onCheckedChange={(next) => void toggle(next)}
            aria-label="Remember across chats"
          />
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : memories.length ? (
          <ul className="flex flex-col gap-1.5 border-t border-border pt-4">
            {memories.map((memory) => (
              <li key={memory.id} className="flex items-start gap-2">
                {editing?.id === memory.id ? (
                  <>
                    <Input
                      autoFocus
                      value={editing.content}
                      onChange={(event) => setEditing({ id: memory.id, content: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void save();
                        if (event.key === "Escape") setEditing(null);
                      }}
                      className="h-8 text-xs"
                    />
                    <Button size="icon-sm" variant="ghost" aria-label="Save memory" onClick={() => void save()}>
                      <Check className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Cancel edit"
                      onClick={() => setEditing(null)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 text-xs">
                      <span className="block">{memory.content}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatRelativeTime(memory.createdAt)}
                      </span>
                    </span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Edit memory"
                      onClick={() => setEditing({ id: memory.id, content: memory.content })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Delete memory"
                      disabled={busy}
                      onClick={() => void remove(memory.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-border pt-4 text-xs text-muted-foreground">
            Nothing remembered yet.
          </p>
        )}

        <div className="flex items-center gap-2 border-t border-border pt-4">
          <Input
            value={draft}
            placeholder="Add a fact to remember, e.g. “Prefers TypeScript with strict mode”"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void add();
            }}
          />
          <Button size="sm" variant="accent" disabled={busy || draft.trim().length < 3} onClick={() => void add()}>
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}