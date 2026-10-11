"use client";

import * as React from "react";
import { Check, ChevronRight, Loader2, PlugZap, RefreshCw, ShieldAlert, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, type McpCacheDto, type McpServerDto } from "@/lib/api-client";
import { useUIStore } from "@/lib/store/ui-store";

/**
 * MCP servers: add a Streamable HTTP or HTTP+SSE endpoint, list what it offers,
 * and decide whether its tools need an approval click. Tools appear in the
 * composer's tools menu and are opted into per chat.
 */

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

function stamp(ms: number | null): string {
  if (!ms) return "never synced";
  return `synced ${new Date(ms).toLocaleString()}`;
}

export function McpServersManager() {
  const [servers, setServers] = React.useState<McpServerDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [cache, setCache] = React.useState<McpCacheDto | null>(null);

  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [transport, setTransport] = React.useState<"http" | "sse">("http");
  const [headers, setHeaders] = React.useState("");
  const [requiresApproval, setRequiresApproval] = React.useState(false);

  const setDraft = useUIStore((state) => state.setComposerDraft);

  React.useEffect(() => {
    let cancelled = false;
    api
      .listMcpServers()
      .then((result) => {
        if (!cancelled) setServers(result.servers);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load MCP servers.");
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
      const result = await api.createMcpServer({
        name,
        url,
        transport,
        requiresApproval,
        headers: parseHeaders(headers),
      });
      setServers(result.servers);
      setName("");
      setUrl("");
      setHeaders("");
      setNotice(
        result.synced
          ? "Connected. Its tools are in the composer's tools menu."
          : `Saved, but the first sync failed: ${result.syncError ?? "unknown error"}`
      );
    });

  const toggleField = (server: McpServerDto, patch: Record<string, unknown>) =>
    run(`${server.id}-${Object.keys(patch)[0]}`, async () => {
      const result = await api.updateMcpServer(server.id, patch);
      setServers(result.servers);
    });

  const refresh = (server: McpServerDto) =>
    run(`${server.id}-refresh`, async () => {
      const result = await api.refreshMcpServer(server.id);
      setServers(result.servers);
      setNotice(`${server.name}: ${result.cache.toolCount} tools, ${result.cache.resourceCount} resources.`);
      if (openId === server.id) setCache((await api.getMcpServer(server.id)).cache);
    });

  const test = (server: McpServerDto) =>
    run(`${server.id}-test`, async () => {
      const result = await api.testMcpServer(server.id, { url: server.url, transport: server.transport });
      setNotice(
        `${server.name}: ${result.test.toolCount} tools, ${result.test.resourceCount} resources, ` +
          `${result.test.promptCount} prompts${result.test.serverInfo ? ` · ${result.test.serverInfo}` : ""}.`
      );
    });

  const open = (server: McpServerDto) =>
    run(`${server.id}-open`, async () => {
      if (openId === server.id) {
        setOpenId(null);
        setCache(null);
        return;
      }
      const result = await api.getMcpServer(server.id);
      setOpenId(server.id);
      setCache(result.cache);
    });

  const remove = (server: McpServerDto) =>
    run(`${server.id}-delete`, async () => {
      const result = await api.deleteMcpServer(server.id);
      setServers(result.servers);
      if (openId === server.id) {
        setOpenId(null);
        setCache(null);
      }
    });

  const insert = (text: string) => {
    setDraft(text);
    setNotice("Inserted into the composer.");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlugZap className="size-4 text-accent" />
          MCP servers
        </CardTitle>
        <CardDescription>
          Connect remote Model Context Protocol servers over Streamable HTTP or HTTP+SSE. Conduit lists their
          tools, resources, and prompts; tools are called from the server, and you choose which ones each chat
          may use.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading MCP servers…
          </p>
        ) : servers.length ? (
          <ul className="flex flex-col gap-2">
            {servers.map((server) => (
              <li key={server.id} className="rounded-xl border border-border px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{server.name}</span>
                  <Badge variant="outline">{server.transport === "sse" ? "HTTP+SSE" : "Streamable HTTP"}</Badge>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{server.url}</span>
                  <span className="text-muted-foreground">
                    {server.toolCount} tools · {server.resourceCount} resources · {server.promptCount} prompts
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {server.serverInfo ? `${server.serverInfo} · ` : ""}
                  {stamp(server.lastSyncedAt)}
                  {server.error ? ` · ${server.error}` : ""}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5">
                    <Switch
                      checked={server.enabled}
                      onCheckedChange={(checked) => void toggleField(server, { enabled: checked })}
                      aria-label={`Enable ${server.name}`}
                    />
                    Enabled
                  </label>
                  <label className="flex items-center gap-1.5">
                    <Switch
                      checked={server.requiresApproval}
                      onCheckedChange={(checked) => void toggleField(server, { requiresApproval: checked })}
                      aria-label={`Ask before running ${server.name} tools`}
                    />
                    Ask before running
                  </label>
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void refresh(server)}>
                    {busy === `${server.id}-refresh` ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    Refresh
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void test(server)}>
                    {busy === `${server.id}-test` ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Test
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void open(server)}>
                    <ChevronRight className={`size-3.5 transition-transform ${openId === server.id ? "rotate-90" : ""}`} />
                    Details
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => void remove(server)}
                  >
                    <Trash2 className="size-3.5" />
                    Remove
                  </Button>
                </div>

                {openId === server.id ? (
                  <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
                    {cache?.tools.length ? (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tools</p>
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {cache.tools.map((tool) => (
                            <li key={tool.exposed}>
                              <span className="font-medium">{tool.name}</span>
                              <span className="ml-1.5 text-muted-foreground">{tool.description}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {cache?.resources.length ? (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Resources</p>
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {cache.resources.map((resource) => (
                            <li key={resource.uri} className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate">
                                <span className="font-medium">{resource.name}</span>
                                <span className="ml-1.5 text-muted-foreground">{resource.uri}</span>
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy !== null}
                                onClick={() =>
                                  void run(`${server.id}-resource`, async () => {
                                    const result = await api.readMcpResource(server.id, resource.uri);
                                    insert(result.text);
                                  })
                                }
                              >
                                Insert
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {cache?.prompts.length ? (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Prompts</p>
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {cache.prompts.map((prompt) => (
                            <li key={prompt.name} className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate">
                                <span className="font-medium">{prompt.name}</span>
                                <span className="ml-1.5 text-muted-foreground">
                                  {prompt.arguments.map((argument) => argument.name).join(", ")}
                                </span>
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy !== null}
                                onClick={() =>
                                  void run(`${server.id}-prompt`, async () => {
                                    const result = await api.getMcpPrompt(server.id, prompt.name);
                                    insert(result.text);
                                  })
                                }
                              >
                                Insert
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {!cache?.tools.length && !cache?.resources.length && !cache?.prompts.length ? (
                      <p className="text-muted-foreground">Nothing cached yet. Use Refresh to read the server.</p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            No MCP servers yet. Add one below — most local servers listen on a plain HTTP URL.
          </p>
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground">Add a server</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-name">Name</Label>
              <Input id="mcp-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Files" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-transport">Transport</Label>
              <select
                id="mcp-transport"
                value={transport}
                onChange={(event) => setTransport(event.target.value as "http" | "sse")}
                className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-accent/70"
              >
                <option value="http">Streamable HTTP (POST endpoint)</option>
                <option value="sse">HTTP + SSE (legacy)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="mcp-url">URL</Label>
              <Input
                id="mcp-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="http://127.0.0.1:3001/mcp"
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="mcp-headers">Headers (optional)</Label>
              <Textarea
                id="mcp-headers"
                rows={2}
                value={headers}
                onChange={(event) => setHeaders(event.target.value)}
                placeholder={"Authorization: Bearer …\nX-API-Key: …"}
              />
              <p className="text-[11px] text-muted-foreground">
                One <code>Name: value</code> per line. Values are encrypted at rest and never shown again.
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} aria-label="Ask before running tools" />
            Ask me before this server&apos;s tools run
          </label>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="accent" disabled={busy !== null || !name.trim() || !url.trim()} onClick={() => void add()}>
              {busy === "add" ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
              Add and connect
            </Button>
            {notice ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="size-3.5 text-accent" /> {notice}
              </span>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="flex items-center gap-2 text-xs text-destructive">
            <ShieldAlert className="size-3.5" /> {error}
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="text-muted-foreground">
              <X className="size-3" />
            </button>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}