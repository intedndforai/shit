"use client";

import * as React from "react";
import { Check, Loader2, Pencil, Plus, Sparkles, Trash2, Type } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type StyleDto } from "@/lib/api-client";

interface Draft {
  id: string | null;
  name: string;
  instructions: string;
}

const EMPTY_DRAFT: Draft = { id: null, name: "", instructions: "" };

/**
 * Response styles: built-ins plus your own. A chat picks one, and its
 * instructions ride along with the system prompt for that conversation.
 */
export function StylesManager() {
  const [styles, setStyles] = React.useState<StyleDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT);
  const [sample, setSample] = React.useState("");
  const [deriving, setDeriving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    api
      .listStyles()
      .then(({ styles: stored }) => {
        if (!cancelled) setStyles(stored);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load styles.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    const name = draft.name.trim();
    if (!name) {
      setError("Give the style a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (draft.id) {
        const { style } = await api.updateStyle(draft.id, { name, instructions: draft.instructions });
        setStyles((current) => current.map((item) => (item.id === style.id ? style : item)));
      } else {
        const { style } = await api.createStyle({ name, instructions: draft.instructions });
        setStyles((current) => [...current, style]);
      }
      setDraft(EMPTY_DRAFT);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the style.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (style: StyleDto) => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteStyle(style.id);
      setStyles((current) => current.filter((item) => item.id !== style.id));
      if (draft.id === style.id) setDraft(EMPTY_DRAFT);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the style.");
    } finally {
      setBusy(false);
    }
  };

  const derive = async () => {
    setDeriving(true);
    setError(null);
    try {
      const { instructions } = await api.styleFromSample(sample);
      setDraft((current) => ({ ...current, instructions, name: current.name || "From my writing" }));
      setSample("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not derive a style from that sample.");
    } finally {
      setDeriving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Type className="size-4 text-accent" />
          Response styles
        </CardTitle>
        <CardDescription>
          Adjust how the assistant writes. Pick a style per chat from the bar above the composer.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {styles.map((style) => (
              <li key={style.id} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{style.name}</span>
                    {style.builtin ? <Badge variant="outline">built-in</Badge> : null}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {style.instructions || "No instructions — the model's own defaults apply."}
                  </p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Edit ${style.name}`}
                  onClick={() => setDraft({ id: style.id, name: style.name, instructions: style.instructions })}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${style.name}`}
                  disabled={busy || style.builtin}
                  title={style.builtin ? "Built-in styles cannot be deleted" : undefined}
                  onClick={() => void remove(style)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground">
            {draft.id ? "Edit style" : "Add a style"}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="style-name">Name</Label>
            <Input
              id="style-name"
              value={draft.name}
              placeholder="e.g. Bullet brief"
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="style-instructions">Instructions</Label>
            <Textarea
              id="style-instructions"
              rows={3}
              value={draft.instructions}
              placeholder="e.g. Answer with at most five bullets. No preamble."
              onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="accent" disabled={busy} onClick={() => void save()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {draft.id ? "Save changes" : "Add style"}
            </Button>
            {draft.id ? (
              <Button size="sm" variant="ghost" onClick={() => setDraft(EMPTY_DRAFT)}>
                Cancel
              </Button>
            ) : null}
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border pt-4">
            <Label htmlFor="style-sample">Or teach it from a writing sample</Label>
            <Textarea
              id="style-sample"
              rows={3}
              value={sample}
              placeholder="Paste a paragraph you wrote; your model turns it into style instructions."
              onChange={(event) => setSample(event.target.value)}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={deriving || sample.trim().length < 40}
                onClick={() => void derive()}
              >
                {deriving ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                Derive instructions
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Needs a provider configured in Settings.
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}