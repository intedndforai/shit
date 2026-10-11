"use client";

import * as React from "react";
import { Check, Loader2, Plus, ShieldAlert, Terminal, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, type CustomToolDto } from "@/lib/api-client";

/**
 * Custom tools: the user describes an HTTP endpoint with a JSON schema and the
 * model can call it. Headers are encrypted at rest; the test button runs the
 * stored definition with empty arguments so a definition can be checked before
 * a model ever sees it.
 */

const EMPTY_SCHEMA = '{\n  "type": "object",\n  "properties": {\n    "query": { "type": "string", "description": "What to look up" }\n  },\n  "required": ["query"]\n}';

function parseHeaders(text: string): Array<{ name: string; value: string | null; secret: boolean }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator < 0) return { name: line, value: "", secret: true };
      return { name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim(), secret: true };
    })
    .filter((header) => header.name.length > 0);
}

export function CustomToolsManager() {
  const [tools, setTools] = React.useState<CustomToolDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [label, setLabel] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [method, setMethod] = React.useState<"GET" | "POST">("GET");
  const [url, setUrl] = React.useState("");
  const [schema, setSchema] = React.useState(EMPTY_SCHEMA);
  const [headers, setHeaders] = React.useState("");
  const [requiresApproval, setRequiresApproval] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    api
      .listCustomTools()
      .then((result) => {
        if (!cancelled) setTools(result.tools);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load custom tools.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  const add = () =>
    run("add", async () => {
      let parameters: Record<string, unknown>;
      try {
        parameters = JSON.parse(schema) as Record<string, unknown>;
      } catch {
        throw new Error("The arguments schema is not valid JSON.");
      }
      const result = await api.createCustomTool({
        label,
        description,
        method,
        url,
        parameters,
        requiresApproval,
        headers: parseHeaders(headers),
      });
      setTools(result.tools);
      setLabel("");
      setDescription("");
      setUrl("");
      setHeaders("");
      setSchema(EMPTY_SCHEMA);
      setNotice("Added. Pick it in the composer's tools menu for the chats that should use it.");
    });

  const patch = (tool: CustomToolDto, patchBody: Record<string, unknown>) =>
    run(`${tool.id}-patch`, async () => {
      const result = await api.updateCustomTool(tool.id, patchBody);
      setTools(result.tools);
    });

  const test = (tool: CustomToolDto) =>
    run(`${tool.id}-test`, async () => {
      const result = await api.testCustomTool(tool.id);
      setNotice(`${tool.label}: HTTP ${result.test.status || "?"} — ${result.test.preview.slice(0, 160)}`);
    });

  const remove = (tool: CustomToolDto) =>
    run(`${tool.id}-delete`, async () => {
      const result = await api.deleteCustomTool(tool.id);
      setTools(result.tools);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="size-4 text-accent" />
          Custom tools
        </CardTitle>
        <CardDescription>
          Describe an HTTP endpoint with a JSON schema and the model can call it. Arguments become a query
          string for GET or a JSON body for POST. Headers are stored encrypted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading custom tools…
          </p>
        ) : tools.length ? (
          <ul className="flex flex-col gap-2">
            {tools.map((tool) => (
              <li key={tool.id} className="rounded-xl border border-border px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{tool.label}</span>
                  <Badge variant="outline">{tool.method}</Badge>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{tool.url}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{tool.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5">
                    <Switch
                      checked={tool.enabled}
                      onCheckedChange={(checked) => void patch(tool, { enabled: checked })}
                      aria-label={`Enable ${tool.label}`}
                    />
                    Enabled
                  </label>
                  <label className="flex items-center gap-1.5">
                    <Switch
                      checked={tool.requiresApproval}
                      onCheckedChange={(checked) => void patch(tool, { requiresApproval: checked })}
                      aria-label={`Ask before running ${tool.label}`}
                    />
                    Ask before running
                  </label>
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void test(tool)}>
                    {busy === `${tool.id}-test` ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Test
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(tool)}>
                    <Trash2 className="size-3.5" />
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No custom tools yet.</p>
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground">Add a tool</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-label">Name</Label>
              <Input id="ct-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Look up an order" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-method">Method</Label>
              <select
                id="ct-method"
                value={method}
                onChange={(event) => setMethod(event.target.value as "GET" | "POST")}
                className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-accent/70"
              >
                <option value="GET">GET (arguments become a query string)</option>
                <option value="POST">POST (arguments become a JSON body)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="ct-url">URL</Label>
              <Input
                id="ct-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://api.example.com/orders"
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="ct-description">Description</Label>
              <Input
                id="ct-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this tool does, and when the model should use it."
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="ct-schema">Arguments (JSON Schema)</Label>
              <Textarea
                id="ct-schema"
                rows={6}
                value={schema}
                onChange={(event) => setSchema(event.target.value)}
                className="font-mono text-[11px]"
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="ct-headers">Headers (optional)</Label>
              <Textarea
                id="ct-headers"
                rows={2}
                value={headers}
                onChange={(event) => setHeaders(event.target.value)}
                placeholder={"Authorization: Bearer …"}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} aria-label="Ask before running the tool" />
            Ask me before this tool runs
          </label>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="accent"
              disabled={busy !== null || !label.trim() || !url.trim()}
              onClick={() => void add()}
            >
              {busy === "add" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Add tool
            </Button>
            {notice ? (
              <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <Check className="size-3.5 shrink-0 text-accent" />
                <span className="truncate">{notice}</span>
              </span>
            ) : null}
          </div>
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