"use client";

import * as React from "react";
import { Check, Globe, Loader2, Search, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { api, type ToolsState } from "@/lib/api-client";

/**
 * Tool configuration: which search backend the model may use and whether it may
 * fetch URLs. The search key is encrypted at rest and never echoed back.
 */
export function ToolsManager() {
  const [state, setState] = React.useState<ToolsState | null>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .getTools()
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load tool settings.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (patch: Record<string, unknown>, note = "Saved.") => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await api.updateTools({ ...patch, ...(apiKey ? { searchApiKey: apiKey } : {}) });
      setState(result);
      setApiKey("");
      setMessage(note);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save tool settings.");
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-4 text-accent" />
            Tools
          </CardTitle>
          <CardDescription>Loading tool settings…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { webSearch } = state.config;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-4 text-accent" />
          Tools
        </CardTitle>
        <CardDescription>
          Models can search the web, read a URL, calculate, tell the time, and analyse CSV data. Nothing is
          called until you enable it and a model asks for it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="web-search-toggle">Web search</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Bring your own search provider. Tavily, Brave, Serper, or a self-hosted SearXNG instance.
            </p>
          </div>
          <Switch
            id="web-search-toggle"
            checked={webSearch.enabled}
            onCheckedChange={(checked) => void save({ webSearch: { enabled: checked } }, checked ? "Web search enabled." : "Web search disabled.")}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="search-provider">Provider</Label>
            <select
              id="search-provider"
              value={webSearch.provider}
              onChange={(event) => void save({ webSearch: { provider: event.target.value } })}
              className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-accent/70"
            >
              <option value="tavily">Tavily</option>
              <option value="brave">Brave Search</option>
              <option value="serper">Serper (Google)</option>
              <option value="searxng">SearXNG (self-hosted)</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="search-key">API key</Label>
            <Input
              id="search-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={state.hasSearchApiKey ? `Stored (${state.maskedSearchApiKey})` : "Paste the provider key"}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>

          {webSearch.provider === "searxng" ? (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="search-base">SearXNG base URL</Label>
              <Input
                id="search-base"
                defaultValue={webSearch.baseUrl ?? ""}
                placeholder="https://searx.example.com"
                onBlur={(event) => void save({ webSearch: { baseUrl: event.target.value.trim() } })}
              />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || (!apiKey && !state.hasSearchApiKey)} onClick={() => void save({}, "Search key saved.")}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            Save search key
          </Button>
          {state.hasSearchApiKey ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void save({ searchApiKey: null }, "Search key removed.")}
            >
              Remove key
            </Button>
          ) : null}
          {message ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="size-3.5 text-accent" /> {message}
            </span>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <div>
            <Label htmlFor="fetch-toggle">Fetch URLs</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Let the model read a public page. Private, loopback, and link-local addresses are always blocked.
            </p>
          </div>
          <Switch
            id="fetch-toggle"
            checked={state.config.fetch.enabled}
            onCheckedChange={(checked) => void save({ fetch: { enabled: checked } })}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground">Built-in tools</p>
          <ul className="flex flex-col gap-1.5">
            {state.specs.map((spec) => (
              <li key={spec.name} className="flex items-start gap-2 text-xs">
                <Badge variant={spec.configured ? "outline" : "warning"} className="mt-0.5 shrink-0">
                  {spec.configured ? "ready" : "needs setup"}
                </Badge>
                <span className="min-w-0">
                  <span className="font-medium">{spec.label}</span>
                  <span className="block text-muted-foreground">{spec.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {error ? (
          <p className="flex items-center gap-2 text-xs text-destructive">
            <ShieldAlert className="size-3.5" /> {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}