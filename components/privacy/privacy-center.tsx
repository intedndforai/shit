"use client";

import * as React from "react";
import { HardDrive, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  api,
  type EgressEventDto,
  type PrivacyProviderDto,
  type PrivacySettingsDto,
  type PrivacyStateDto,
} from "@/lib/api-client";
import { useChatStore } from "@/lib/store/chat-store";
import {
  MINIMUM_POLICY_LABELS,
  PRIVACY_MODE_INFO,
  minimumPolicyLevels,
  privacyModes,
  providerRetentionPolicies,
  providerTrainingPolicies,
  type MinimumPolicy,
  type PrivacyMode,
} from "@/lib/privacy/types";

const SELECT_CLASS =
  "h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-accent/70";

function formatWhen(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/** One editable provider data-policy profile (Section 3.4). */
function ProviderPolicyEditor({
  provider,
  onSaved,
}: {
  provider: PrivacyProviderDto;
  onSaved: () => void;
}) {
  const [training, setTraining] = React.useState(provider.policy.training);
  const [retention, setRetention] = React.useState(provider.policy.retention);
  const [region, setRegion] = React.useState(provider.policy.region ?? "");
  const [url, setUrl] = React.useState(provider.policy.url ?? "");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      await api.updateProvider(provider.id, {
        dataPolicyTraining: training,
        dataPolicyRetention: retention,
        dataPolicyRegion: region.trim() || null,
        dataPolicyUrl: url.trim() || null,
      });
      setNote("Saved.");
      onSaved();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{provider.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {provider.apiFormat} · {provider.host} {provider.local ? "· local endpoint" : ""}
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">{provider.label}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Training use</span>
          <select className={SELECT_CLASS} value={training} onChange={(event) => setTraining(event.target.value)}>
            {providerTrainingPolicies.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Retention</span>
          <select className={SELECT_CLASS} value={retention} onChange={(event) => setRetention(event.target.value)}>
            {providerRetentionPolicies.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Region (free text)</span>
          <Input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="e.g. EU" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Policy link</span>
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          {provider.policy.declaredBy
            ? `Declared by ${provider.policy.declaredBy}${
                provider.policy.declaredAt ? ` on ${formatWhen(provider.policy.declaredAt)}` : ""
              } — never verified.`
            : "Not declared yet. Defaults to unknown."}
          {note ? ` ${note}` : ""}
        </p>
        <Button size="sm" variant="outline" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save policy"}
        </Button>
      </div>
    </div>
  );
}

/** The Privacy Center: modes, storage, destinations, policies, and deletion. */
export function PrivacyCenter() {
  const [state, setState] = React.useState<PrivacyStateDto | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [terms, setTerms] = React.useState("");
  const [patterns, setPatterns] = React.useState("");
  const [retention, setRetention] = React.useState("");
  const chatId = useChatStore((store) => store.chatId);
  const [chatLog, setChatLog] = React.useState<EgressEventDto[]>([]);

  const applyState = (next: PrivacyStateDto) => {
    setState(next);
    setTerms(next.settings.customRedactionTerms.join(", "));
    setPatterns(next.settings.customRedactionPatterns.join("\n"));
    setRetention(next.settings.retentionDays ? String(next.settings.retentionDays) : "");
    setError(null);
  };

  const refresh = async () => {
    try {
      applyState(await api.getPrivacy());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the privacy settings.");
    }
  };

  React.useEffect(() => {
    let alive = true;
    api
      .getPrivacy()
      .then((next) => {
        if (!alive) return;
        setState(next);
        setTerms(next.settings.customRedactionTerms.join(", "));
        setPatterns(next.settings.customRedactionPatterns.join("\n"));
        setRetention(next.settings.retentionDays ? String(next.settings.retentionDays) : "");
        setError(null);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not load the privacy settings.");
      });
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!chatId) return;
    let alive = true;
    api
      .getEgress({ chatId, limit: 50 })
      .then(({ events }) => {
        if (alive) setChatLog(events);
      })
      .catch(() => {
        if (alive) setChatLog([]);
      });
    return () => {
      alive = false;
    };
  }, [chatId]);

  const patch = async (update: Partial<PrivacySettingsDto>) => {
    setBusy("settings");
    try {
      const { settings } = await api.updatePrivacy(update);
      setState((current) => (current ? { ...current, settings } : current));
      setNotice(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  };

  const runAction = async (action: "purge" | "clear-egress" | "delete-all") => {
    setBusy(action);
    setNotice(null);
    try {
      const result = await api.privacyAction({
        action,
        retentionDays: action === "purge" ? Number(retention || 30) : undefined,
      });
      if (action === "clear-egress") {
        setNotice(`Cleared ${result.cleared ?? 0} egress log entries.`);
        setChatLog([]);
      } else if (action === "purge") {
        setNotice(`Purged. ${JSON.stringify(result.result ?? {})}`);
      } else {
        setNotice("All local content was deleted and the database was compacted.");
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That action failed.");
    } finally {
      setBusy(null);
    }
  };

  const settings = state?.settings;

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">{notice}</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> Privacy modes
          </CardTitle>
          <CardDescription>
            A workspace default plus a per-chat override in the composer. Every mode changes real
            behavior in the chat route.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Default mode for new chats</span>
              <select
                className={SELECT_CLASS}
                value={settings?.defaultMode ?? "standard"}
                onChange={(event) => void patch({ defaultMode: event.target.value as PrivacyMode })}
              >
                {privacyModes.map((value) => (
                  <option key={value} value={value}>
                    {PRIVACY_MODE_INFO[value].label}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-muted-foreground">
                {PRIVACY_MODE_INFO[(settings?.defaultMode ?? "standard") as PrivacyMode].detail}
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Minimum provider policy (Private mode)</span>
              <select
                className={SELECT_CLASS}
                value={settings?.minimumProviderPolicy ?? "any"}
                onChange={(event) => void patch({ minimumProviderPolicy: event.target.value as MinimumPolicy })}
              >
                {minimumPolicyLevels.map((value) => (
                  <option key={value} value={value}>
                    {MINIMUM_POLICY_LABELS[value]}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-muted-foreground">
                Applied only in Private mode; the gate offers a switch, a mode change, or a one-time send.
              </span>
            </label>
          </div>

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Block remote images in rendered Markdown</p>
              <p className="text-[11px] text-muted-foreground">
                An image URL can leak a request and IP to a third party. Blocked images become a
                placeholder with the destination domain and a per-image load button.
              </p>
            </div>
            <Switch
              checked={settings?.blockRemoteImages ?? true}
              onCheckedChange={(next) => void patch({ blockRemoteImages: next })}
              aria-label="Block remote images"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Confirm before every send</p>
              <p className="text-[11px] text-muted-foreground">
                The &quot;What will be sent&quot; inspector is always available; this asks you to open it first.
              </p>
            </div>
            <Switch
              checked={settings?.requireSendPreview ?? false}
              onCheckedChange={(next) => void patch({ requireSendPreview: next })}
              aria-label="Require send preview"
            />
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Custom redaction terms (comma separated)</span>
              <Input
                value={terms}
                onChange={(event) => setTerms(event.target.value)}
                onBlur={() =>
                  void patch({
                    customRedactionTerms: terms
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Project codenames, names, addresses"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Custom redaction patterns (one regex per line)</span>
              <textarea
                className="min-h-[38px] rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus-visible:border-accent/70"
                value={patterns}
                onChange={(event) => setPatterns(event.target.value)}
                onBlur={() =>
                  void patch({
                    customRedactionPatterns: patterns
                      .split("\n")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="ACCT-\d{6}"
              />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Detection is best-effort, not a guarantee. Redaction is reversible: masked values are
            restored in the reply before display and before saving.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="size-4" /> What is stored and where
          </CardTitle>
          <CardDescription>
            Server-side SQLite row counts. Metadata only — no message bodies are shown here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {state
              ? (
                  [
                    ["Chats", state.summary.chats],
                    ["Messages", state.summary.messages],
                    ["Attachments", state.summary.attachments],
                    ["Artifacts", state.summary.artifacts],
                    ["Memories", state.summary.memories],
                    ["Projects", state.summary.projects],
                    ["Project files", state.summary.projectFiles],
                    ["Usage events", state.summary.usageEvents],
                    ["Egress log", state.summary.egressEvents],
                  ] as Array<[string, number]>
                ).map(([label, value]) => (
                  <div key={label} className="rounded-md border border-border px-2 py-1.5">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="text-sm font-medium">{value}</p>
                  </div>
                ))
              : null}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Database file</span>
            <code className="truncate rounded-md bg-secondary px-2 py-0.5 font-mono text-[11px]">
              {state?.summary.databasePath ?? "—"}
            </code>
          </div>
          <Separator />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Retention (days, empty = keep)</span>
              <Input
                className="w-28"
                value={retention}
                onChange={(event) => setRetention(event.target.value)}
                onBlur={() =>
                  void patch({ retentionDays: retention.trim() ? Number(retention) : null })
                }
                inputMode="numeric"
                placeholder="Keep"
              />
            </label>
            <Button variant="outline" size="sm" onClick={() => void runAction("purge")} disabled={busy !== null}>
              <RefreshCw className="size-3.5" /> Purge older chats now
            </Button>
            <Button variant="outline" size="sm" onClick={() => void runAction("clear-egress")} disabled={busy !== null}>
              Clear egress log
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (
                  window.confirm(
                    "Delete all local content? This removes chats, messages, attachments, artifacts, projects, memories, usage records, and the egress log, then compacts the database. This cannot be undone."
                  )
                ) {
                  void runAction("delete-all");
                }
              }}
              disabled={busy !== null}
            >
              <Trash2 className="size-3.5" /> Delete all my data
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Deletion cascades to derived chunks and embeddings and runs a WAL checkpoint plus VACUUM
            with secure_delete on. Data you exported or that a provider retained is outside Conduit&apos;s
            control.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Destinations used</CardTitle>
          <CardDescription>
            Every outbound request is logged as metadata: kind, destination host, byte count, redaction
            count, and a payload hash. Never the content itself.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {state?.destinations.length ? (
            state.destinations.map((destination) => (
              <div key={destination.destination} className="flex items-center justify-between gap-3 rounded-md border border-border px-2 py-1.5">
                <span className="min-w-0 truncate font-mono text-xs">{destination.destination}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {destination.kinds.join(", ")} · {destination.count}× · last {formatWhen(destination.lastAt)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">No outbound requests logged yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provider data-policy profiles</CardTitle>
          <CardDescription>
            These are user-declared values, never verified by Conduit. In Private mode, the gate uses
            them against your minimum policy.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {state?.providers.length ? (
            state.providers.map((provider) => (
              <ProviderPolicyEditor
                key={`${provider.id}:${provider.policy.training}:${provider.policy.retention}:${provider.policy.region ?? ""}:${provider.policy.url ?? ""}`}
                provider={provider}
                onSaved={() => void refresh()}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No providers configured yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>This chat&apos;s privacy report</CardTitle>
          <CardDescription>
            {chatId
              ? `Egress recorded for the open chat (${chatLog.length} recent event${chatLog.length === 1 ? "" : "s"}).`
              : "Open a chat to see its per-chat egress report."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {chatLog.length ? (
            chatLog.map((event) => (
              <div key={event.id} className="flex items-start justify-between gap-3 rounded-md border border-border px-2 py-1.5">
                <div className="min-w-0">
                  <p className="text-xs font-medium">
                    {event.kind} · {event.destination}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {event.label ?? ""} {event.payloadHash ? `· ${event.payloadHash.slice(0, 12)}…` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {event.status} · {event.redactionCount} masked · {formatWhen(event.createdAt)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">Nothing recorded for this chat yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
