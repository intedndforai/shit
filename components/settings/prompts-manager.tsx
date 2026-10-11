"use client";

import * as React from "react";
import { Check, Pencil, Plus, Terminal, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type PromptDto } from "@/lib/api-client";

/**
 * Slash commands. Type "/" in the composer to insert one; `{text}` in the body
 * is replaced with whatever you had already typed.
 */
export function PromptsManager() {
  const [prompts, setPrompts] = React.useState<PromptDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState({ name: "", command: "", content: "" });
  const [editing, setEditing] = React.useState<{ id: string; content: string } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .listPrompts()
      .then(({ prompts: stored }) => {
        if (!cancelled) setPrompts(stored);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load commands.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const add = async () => {
    const name = draft.name.trim();
    const content = draft.content.trim();
    if (!name || !content) {
      setError("A command needs a name and a body.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { prompt } = await api.createPrompt({ name, command: draft.command.trim() || name, content });
      setPrompts((current) => [...current, prompt]);
      setDraft({ name: "", command: "", content: "" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that command.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const { prompt } = await api.updatePrompt(editing.id, { content: editing.content });
      setPrompts((current) => current.map((item) => (item.id === prompt.id ? prompt : item)));
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update that command.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (prompt: PromptDto) => {
    setBusy(true);
    setError(null);
    try {
      await api.deletePrompt(prompt.id);
      setPrompts((current) => current.filter((item) => item.id !== prompt.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete that command.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="size-4 text-accent" />
          Slash commands
        </CardTitle>
        <CardDescription>
          Reusable prompts that appear when you type <code className="font-mono">/</code> in the composer.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {prompts.map((prompt) => (
              <li key={prompt.id} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <code className="font-mono text-xs text-accent">/{prompt.command}</code>
                    <span className="truncate">{prompt.name}</span>
                    {prompt.builtin ? <Badge variant="outline">built-in</Badge> : null}
                  </p>
                  {editing?.id === prompt.id ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <Textarea
                        rows={3}
                        value={editing.content}
                        onChange={(event) => setEditing({ id: prompt.id, content: event.target.value })}
                      />
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="accent" disabled={busy} onClick={() => void save()}>
                          <Check className="size-3.5" /> Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          <X className="size-3.5" /> Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                      {prompt.content}
                    </p>
                  )}
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Edit /${prompt.command}`}
                  onClick={() => setEditing({ id: prompt.id, content: prompt.content })}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete /${prompt.command}`}
                  disabled={busy || prompt.builtin}
                  title={prompt.builtin ? "Built-in commands cannot be deleted" : undefined}
                  onClick={() => void remove(prompt)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground">Add a command</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prompt-name">Name</Label>
              <Input
                id="prompt-name"
                value={draft.name}
                placeholder="e.g. Release notes"
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prompt-command">Command</Label>
              <Input
                id="prompt-command"
                value={draft.command}
                placeholder="e.g. release-notes"
                onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prompt-content">Body</Label>
            <Textarea
              id="prompt-content"
              rows={3}
              value={draft.content}
              placeholder={"Turn this into release notes:\n\n{text}"}
              onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
            />
            <p className="text-[11px] text-muted-foreground">
              Use <code className="font-mono">{"{text}"}</code> where your typed message should go.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="accent" disabled={busy} onClick={() => void add()}>
              <Plus className="size-3.5" /> Add command
            </Button>
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}