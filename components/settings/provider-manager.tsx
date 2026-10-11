"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  Loader2,
  Pencil,
  PlugZap,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type PublicProvider, type StoredModel } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type FormState = {
  id?: string;
  name: string;
  baseUrl: string;
  apiFormat: PublicProvider["apiFormat"];
  apiKey: string;
  customHeaders: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  baseUrl: "",
  apiFormat: "openai-completions",
  apiKey: "",
  customHeaders: "",
};

const FORMAT_LABEL: Record<PublicProvider["apiFormat"], string> = {
  "openai-completions": "OpenAI-compatible",
  "openai-responses": "OpenAI Responses",
  anthropic: "Anthropic Messages",
  gemini: "Google Gemini",
};

const CAPABILITIES = [
  { key: "vision", label: "Vision" },
  { key: "toolCalling", label: "Tools" },
  { key: "reasoning", label: "Reasoning" },
  { key: "jsonMode", label: "JSON mode" },
  { key: "promptCaching", label: "Prompt caching" },
] as const;

/** Provider + model management for the Settings screen. */
export function ProviderManager() {
  const [providers, setProviders] = React.useState<PublicProvider[] | null>(null);
  const [models, setModels] = React.useState<Record<string, StoredModel[]>>({});
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const { providers: list } = await api.listProviders();
    setProviders(list);
    return list;
  }, []);

  React.useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const { providers: list } = await api.listProviders();
        if (active) setProviders(list);
      } catch (error) {
        if (!active) return;
        setProviders([]);
        toast.error(error instanceof Error ? error.message : "Could not load providers.");
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const loadModels = React.useCallback(async (providerId: string) => {
    const { models: list } = await api.listModels(providerId);
    setModels((current) => ({ ...current, [providerId]: list }));
    return list;
  }, []);

  const toggleExpanded = async (providerId: string) => {
    if (expanded === providerId) {
      setExpanded(null);
      return;
    }
    setExpanded(providerId);
    if (!models[providerId]) {
      try {
        await loadModels(providerId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load models.");
      }
    }
  };

  const save = async () => {
    if (!form) return;
    const payload = {
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      apiFormat: form.apiFormat,
      ...(form.apiKey ? { apiKey: form.apiKey.trim() } : {}),
      customHeaders: parseHeaders(form.customHeaders),
    };

    setBusy("save");
    try {
      if (form.id) {
        await api.updateProvider(form.id, payload);
        toast.success("Provider updated");
      } else {
        await api.createProvider(payload);
        toast.success("Provider added");
      }
      setForm(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the provider.");
    } finally {
      setBusy(null);
    }
  };

  const test = async (provider: PublicProvider) => {
    setBusy(`test-${provider.id}`);
    try {
      const result = await api.testProvider(provider.id);
      toast.success(`Connection OK — ${result.models} model${result.models === 1 ? "" : "s"} visible`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection test failed.");
    } finally {
      setBusy(null);
    }
  };

  const discover = async (provider: PublicProvider) => {
    setBusy(`models-${provider.id}`);
    try {
      const { models: list } = await api.discoverModels(provider.id);
      setModels((current) => ({ ...current, [provider.id]: list }));
      setExpanded(provider.id);
      toast.success(`Found ${list.length} model${list.length === 1 ? "" : "s"}`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not fetch models.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (provider: PublicProvider) => {
    setBusy(`delete-${provider.id}`);
    try {
      await api.deleteProvider(provider.id);
      toast.success("Provider removed");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the provider.");
    } finally {
      setBusy(null);
    }
  };

  const startEdit = (provider: PublicProvider) => {
    setForm({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat,
      apiKey: "",
      customHeaders: Object.entries(provider.customHeaders ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n"),
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Providers</CardTitle>
          <CardDescription>
            Connect unlimited providers with their own Base URL, key, headers, and API format. Keys are
            encrypted with AES-256-GCM on the server.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setForm({ ...EMPTY_FORM })}>
          <Plus className="size-3.5" />
          Add provider
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {providers === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : providers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center">
            <PlugZap className="mx-auto mb-2 size-5 text-muted-foreground" />
            <p className="font-serif text-base font-medium">No providers yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Point Conduit at any OpenAI-compatible server (Ollama, LM Studio, vLLM, OpenRouter,
              OpenAI) or an Anthropic Messages endpoint.
            </p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setForm({ ...EMPTY_FORM })}>
              Add your first provider
            </Button>
          </div>
        ) : (
          providers.map((provider) => (
            <div key={provider.id} className="rounded-xl border border-border">
              <div className="flex flex-wrap items-center gap-2 p-3">
                <button
                  type="button"
                  onClick={() => void toggleExpanded(provider.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={expanded === provider.id}
                >
                  {expanded === provider.id ? (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{provider.name}</span>
                      {provider.isDefault ? <Badge variant="accent">Default</Badge> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {provider.baseUrl} · {FORMAT_LABEL[provider.apiFormat]}
                      {provider.hasApiKey ? ` · key ${provider.maskedApiKey}` : " · no key"}
                    </span>
                  </span>
                </button>

                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void test(provider)}
                    disabled={busy === `test-${provider.id}`}
                  >
                    {busy === `test-${provider.id}` ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void discover(provider)}
                    disabled={busy === `models-${provider.id}`}
                  >
                    {busy === `models-${provider.id}` ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CloudDownload className="size-3.5" />
                    )}
                    Models
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Edit provider"
                    onClick={() => startEdit(provider)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete provider"
                    onClick={() => void remove(provider)}
                    disabled={busy === `delete-${provider.id}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              {expanded === provider.id ? (
                <>
                  <Separator />
                  <div className="flex flex-col gap-2 p-3">
                    {(models[provider.id] ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No models saved yet. Use “Models” to fetch the list from{" "}
                        <code className="font-mono">{provider.baseUrl}/models</code>.
                      </p>
                    ) : (
                      (models[provider.id] ?? []).map((model) => (
                        <ModelRow
                          key={model.id}
                          model={model}
                          onChanged={(updated) =>
                            setModels((current) => ({
                              ...current,
                              [provider.id]: (current[provider.id] ?? []).map((item) =>
                                item.id === updated.id ? updated : item
                              ),
                            }))
                          }
                        />
                      ))
                    )}
                  </div>
                </>
              ) : null}
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={Boolean(form)} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit provider" : "Add provider"}</DialogTitle>
            <DialogDescription>
              The key is sent once to your server, encrypted, and never returned to the browser.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-name">Name</Label>
              <Input
                id="provider-name"
                value={form?.name ?? ""}
                onChange={(event) => setForm((current) => (current ? { ...current, name: event.target.value } : current))}
                placeholder="Local Ollama"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-format">API format</Label>
              <select
                id="provider-format"
                className="h-9 rounded-lg border border-input bg-card px-3 text-sm"
                value={form?.apiFormat ?? "openai-completions"}
                onChange={(event) =>
                  setForm((current) =>
                    current ? { ...current, apiFormat: event.target.value as PublicProvider["apiFormat"] } : current
                  )
                }
              >
                <option value="openai-completions">OpenAI-compatible (Chat Completions)</option>
                <option value="anthropic">Anthropic Messages API</option>
                <option value="openai-responses" disabled>
                  OpenAI Responses API (coming soon)
                </option>
                <option value="gemini" disabled>
                  Google Gemini (coming soon)
                </option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="provider-url">Base URL</Label>
              <Input
                id="provider-url"
                value={form?.baseUrl ?? ""}
                onChange={(event) => setForm((current) => (current ? { ...current, baseUrl: event.target.value } : current))}
                placeholder="http://localhost:11434/v1"
              />
              <p className="text-xs text-muted-foreground">
                Point at the API root. Conduit calls <code className="font-mono">/chat/completions</code> (or{" "}
                <code className="font-mono">/messages</code>) and <code className="font-mono">/models</code>{" "}
                relative to it.
              </p>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="provider-key">API key</Label>
              <Input
                id="provider-key"
                type="password"
                value={form?.apiKey ?? ""}
                onChange={(event) => setForm((current) => (current ? { ...current, apiKey: event.target.value } : current))}
                placeholder={form?.id ? "Leave blank to keep the stored key" : "sk-..."}
              />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="provider-headers">Custom headers (optional)</Label>
              <textarea
                id="provider-headers"
                rows={3}
                className="rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs"
                value={form?.customHeaders ?? ""}
                onChange={(event) =>
                  setForm((current) => (current ? { ...current, customHeaders: event.target.value } : current))
                }
                placeholder={"X-Project-Id: abc\nX-Region: eu"}
              />
              <p className="text-xs text-muted-foreground">One <code className="font-mono">Header: value</code> per line.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy === "save" || !form?.name || !form?.baseUrl}>
              {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {form?.id ? "Save changes" : "Add provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Per-model settings: capabilities, context, pricing, and default flags. */
function ModelRow({
  model,
  onChanged,
}: {
  model: StoredModel;
  onChanged: (model: StoredModel) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const patch = async (input: Record<string, unknown>) => {
    setSaving(true);
    try {
      const { model: updated } = await api.updateModel(model.id, input);
      onChanged(updated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the model.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-secondary/30">
      <div className="flex flex-wrap items-center gap-2 p-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <span className="truncate font-mono text-xs">{model.externalId}</span>
          {model.isDefault ? <Badge variant="accent">Default</Badge> : null}
          {model.isFallback ? <Badge variant="outline">Fallback</Badge> : null}
        </button>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => void patch({ isDefault: true })}
          disabled={model.isDefault || saving}
        >
          <Star className="size-3.5" />
          Set default
        </Button>
      </div>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label>Context window</Label>
              <Input
                type="number"
                defaultValue={model.contextWindow}
                className="h-8 text-xs"
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (value && value !== model.contextWindow) void patch({ contextWindow: value });
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Max output</Label>
              <Input
                type="number"
                defaultValue={model.maxOutputTokens}
                className="h-8 text-xs"
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (value && value !== model.maxOutputTokens) void patch({ maxOutputTokens: value });
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Display name</Label>
              <Input
                defaultValue={model.displayName ?? ""}
                className="h-8 text-xs"
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value !== (model.displayName ?? "")) void patch({ displayName: value || null });
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Price / 1M in</Label>
              <Input
                type="number"
                step="0.01"
                defaultValue={model.pricePerMillionInput}
                className="h-8 text-xs"
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (value !== model.pricePerMillionInput) void patch({ pricePerMillionInput: value });
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Price / 1M out</Label>
              <Input
                type="number"
                step="0.01"
                defaultValue={model.pricePerMillionOutput}
                className="h-8 text-xs"
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (value !== model.pricePerMillionOutput) void patch({ pricePerMillionOutput: value });
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-2 py-1.5">
              <Label htmlFor={`fallback-${model.id}`} className="text-xs">
                Fallback model
              </Label>
              <Switch
                id={`fallback-${model.id}`}
                checked={model.isFallback}
                onCheckedChange={(checked) => void patch({ isFallback: checked })}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {CAPABILITIES.map((capability) => (
              <label key={capability.key} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className={cn("size-3.5 accent-[var(--accent)]")}
                  checked={Boolean(model.capabilities?.[capability.key])}
                  onChange={(event) =>
                    void patch({
                      capabilities: { ...(model.capabilities ?? {}), [capability.key]: event.target.checked },
                    })
                  }
                />
                {capability.label}
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function parseHeaders(input: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of input.split("\n")) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key && value) headers[key] = value;
  }
  return headers;
}