"use client";

import * as React from "react";
import { Check, Loader2, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type StoredPreset } from "@/lib/api-client";
import { BUILTIN_PRESETS } from "@/lib/presets";

/**
 * Saved conversation-control presets. Built-in presets are shown for reference;
 * the ones you create here appear in a chat's settings dialog.
 */
export function PresetsManager() {
  const [presets, setPresets] = React.useState<StoredPreset[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState({
    name: "",
    temperature: "0.7",
    topP: "1",
    maxTokens: "8192",
    thinkingBudget: "",
  });

  React.useEffect(() => {
    let cancelled = false;
    api
      .listPresets()
      .then(({ presets: stored }) => {
        if (!cancelled) setPresets(stored);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load presets.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (next: StoredPreset[], note: string) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await api.savePresets(next);
      setPresets(result.presets);
      setMessage(note);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save presets.");
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const name = draft.name.trim();
    if (!name) {
      setError("Give the preset a name first.");
      return;
    }
    const thinkingRaw = draft.thinkingBudget.trim();
    const preset: StoredPreset = {
      id: `preset-${Date.now().toString(36)}`,
      name,
      temperature: Math.min(2, Math.max(0, Number(draft.temperature) || 0)),
      topP: Math.min(1, Math.max(0.05, Number(draft.topP) || 1)),
      maxTokens: Math.max(1, Math.round(Number(draft.maxTokens) || 8192)),
      thinkingBudget: thinkingRaw ? Math.max(0, Math.round(Number(thinkingRaw) || 0)) : null,
      systemPrompt: null,
    };
    void save([...presets, preset], `Saved “${name}”.`);
    setDraft({ name: "", temperature: "0.7", topP: "1", maxTokens: "8192", thinkingBudget: "" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-accent" />
          Presets
        </CardTitle>
        <CardDescription>
          Reusable sampling settings for a conversation. Pick one from a chat&apos;s settings dialog.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Built in</p>
          <ul className="flex flex-wrap gap-1.5">
            {BUILTIN_PRESETS.map((preset) => (
              <li
                key={preset.id}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground"
                title={`temperature ${preset.temperature}, top_p ${preset.topP}, max ${preset.maxTokens} tokens`}
              >
                {preset.name}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground">Your presets</p>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : presets.length ? (
            <ul className="flex flex-col gap-1.5">
              {presets.map((preset) => (
                <li key={preset.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{preset.name}</span>
                    <span className="ml-2 text-muted-foreground">
                      temp {preset.temperature} · top_p {preset.topP} · {preset.maxTokens} tokens
                      {preset.thinkingBudget ? ` · thinking ${preset.thinkingBudget}` : ""}
                    </span>
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${preset.name}`}
                    disabled={busy}
                    onClick={() => void save(presets.filter((item) => item.id !== preset.id), `Removed “${preset.name}”.`)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No custom presets yet.</p>
          )}
        </div>

        <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-name">Name</Label>
            <Input
              id="preset-name"
              value={draft.name}
              placeholder="e.g. Code review"
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-thinking">Thinking budget</Label>
            <Input
              id="preset-thinking"
              value={draft.thinkingBudget}
              placeholder="blank = model default"
              onChange={(event) => setDraft((current) => ({ ...current, thinkingBudget: event.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-temperature">Temperature</Label>
            <Input
              id="preset-temperature"
              value={draft.temperature}
              onChange={(event) => setDraft((current) => ({ ...current, temperature: event.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-top-p">Top P</Label>
            <Input
              id="preset-top-p"
              value={draft.topP}
              onChange={(event) => setDraft((current) => ({ ...current, topP: event.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-max">Max output tokens</Label>
            <Input
              id="preset-max"
              value={draft.maxTokens}
              onChange={(event) => setDraft((current) => ({ ...current, maxTokens: event.target.value }))}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="accent" disabled={busy} onClick={add}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add preset
          </Button>
          {message ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="size-3.5 text-accent" /> {message}
            </span>
          ) : null}
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}