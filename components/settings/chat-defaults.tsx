"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { api, type ChatDefaultsDto, type ModelOptionDto, type PresetOptionDto } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Workspace defaults for brand-new chats. The server stores them, so a chat
 * created from another tab or a first message already carries them.
 */
export function ChatDefaults() {
  const [presets, setPresets] = React.useState<PresetOptionDto[]>([]);
  const [models, setModels] = React.useState<ModelOptionDto[]>([]);
  const [defaults, setDefaults] = React.useState<ChatDefaultsDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .getDefaults()
      .then((data) => {
        if (cancelled) return;
        setPresets(data.presets);
        setModels(data.models);
        setDefaults(data.defaults);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the defaults.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (patch: { presetId?: string; modelId?: string | null }) => {
    setSaving(true);
    setError(null);
    try {
      const data = await api.saveDefaults(patch);
      setDefaults(data.defaults);
      setPresets(data.presets);
      setModels(data.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the default.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat defaults</CardTitle>
        <CardDescription>
          What every new chat starts with: the model it is pinned to and its AI performance level.
          Existing chats keep their own settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading defaults…
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Label htmlFor="default-model">Default model</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  New chats are pinned to this model until you switch.
                </p>
              </div>
              <Select
                value={defaults?.modelId ?? ""}
                onValueChange={(value) => void save({ modelId: value })}
                disabled={saving || !models.length}
              >
                <SelectTrigger id="default-model" className="w-64" aria-label="Default model">
                  <SelectValue placeholder="No models yet" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {(model.displayName ?? model.externalId) + " · " + model.providerName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Label htmlFor="default-performance">Default AI performance</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sampling, output length, and thinking budget for new chats.
                </p>
              </div>
              <Select
                value={defaults?.presetId ?? "balanced"}
                onValueChange={(value) => void save({ presetId: value })}
                disabled={saving}
              >
                <SelectTrigger id="default-performance" className="w-64" aria-label="Default AI performance">
                  <SelectValue placeholder="Balanced" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.builtin ? preset.name : preset.name + " (saved)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!models.length ? (
              <p className="text-xs text-muted-foreground">
                Add a provider and discover its models to pick a default model.
              </p>
            ) : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}