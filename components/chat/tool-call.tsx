"use client";

import * as React from "react";
import { Check, ChevronRight, Loader2, Play, ShieldCheck, TriangleAlert, Wrench, X } from "lucide-react";
import type { ContentPart } from "@/lib/db/schema";
import { denyToolInBrowser, runToolInBrowser } from "@/lib/client/code-tools";
import { api } from "@/lib/api-client";
import { useUIStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

type ToolUsePart = Extract<ContentPart, { kind: "tool_use" }>;
type ToolResultPart = Extract<ContentPart, { kind: "tool_result" }>;

const CLIENT_TOOLS = new Set(["run_python", "run_javascript"]);

function humanise(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function summariseInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const entries = Object.entries(input as Record<string, unknown>);
  if (!entries.length) return "";
  return entries
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ")
    .slice(0, 160);
}

function codeOf(input: unknown): string {
  const code = (input as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : "";
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Approve/run/deny controls plus stdout, figures and files for code tools. */
function CodeRunPanel({ call }: { call: ToolUsePart }) {
  const run = useUIStore((state) => state.toolRuns[call.id]);
  const startToolRun = useUIStore((state) => state.startToolRun);

  const status = run?.status ?? (call.status === "awaiting_approval" ? "approval" : call.status ?? "running");
  const needsApproval = run ? run.requiresApproval : true;
  const code = codeOf(call.input);

  // A chat the user enabled "run without asking" for starts on its own.
  React.useEffect(() => {
    if (status !== "approval" || needsApproval) return;
    const timer = setTimeout(() => void runToolInBrowser(call.id), 0);
    return () => clearTimeout(timer);
  }, [status, needsApproval, call.id]);

  const ensureRun = () => {
    if (useUIStore.getState().toolRuns[call.id]) return;
    startToolRun({
      id: call.id,
      name: call.name,
      label: humanise(call.name),
      input: call.input,
      requiresApproval: true,
      execution: "client",
      status: "approval",
      stdout: "",
      stderr: "",
      figures: [],
      files: [],
    });
  };

  if (status === "approval") {
    return (
      <div className="rounded-xl border border-accent/40 bg-accent/5 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-3.5 shrink-0 text-accent" />
          <span className="font-medium">
            {call.name === "run_python" ? "Run this Python?" : "Run this JavaScript?"}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Runs in your browser. Nothing is sent to the server.
          </span>
        </div>
        {code ? (
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-secondary/60 p-2 text-[11px]">{code}</pre>
        ) : null}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => {
              ensureRun();
              void runToolInBrowser(call.id);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 font-medium text-accent-foreground hover:opacity-90"
          >
            <Play className="size-3" />
            Run
          </button>
          <button
            type="button"
            onClick={() => {
              ensureRun();
              void denyToolInBrowser(call.id);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-muted-foreground hover:bg-secondary"
          >
            <X className="size-3" />
            Skip
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card/60 px-3 py-2 text-xs",
        status === "error" ? "border-destructive/40" : "border-border"
      )}
    >
      <div className="flex items-center gap-2">
        {status === "running" ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : status === "error" ? (
          <TriangleAlert className="size-3.5 shrink-0 text-destructive" />
        ) : status === "denied" ? (
          <X className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Check className="size-3.5 shrink-0 text-accent" />
        )}
        <span className="font-medium">{humanise(call.name)}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {status === "running" ? run?.note ?? "Running in your browser…" : sizeLabel(code.length) + " of code"}
        </span>
        {typeof run?.durationMs === "number" && status !== "running" ? (
          <span className="text-muted-foreground">{(run.durationMs / 1000).toFixed(1)}s</span>
        ) : null}
      </div>

      {status === "denied" ? (
        <p className="mt-1.5 text-muted-foreground">You skipped this run. The model was told.</p>
      ) : null}

      {run?.stdout ? (
        <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-secondary/50 p-2 text-[11px]">{run.stdout}</pre>
      ) : null}
      {run?.stderr ? (
        <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-destructive/10 p-2 text-[11px] text-destructive">
          {run.stderr}
        </pre>
      ) : null}
      {run?.result ? (
        <p className="mt-1.5 break-words font-mono text-[11px] text-muted-foreground">= {run.result}</p>
      ) : null}
      {run?.error ? <p className="mt-1.5 text-[11px] text-destructive">{run.error}</p> : null}

      {run?.figures.length ? (
        <div className="mt-2 flex flex-col gap-2">
          {run.figures.map((figure, index) => (
            <a key={index} href={figure} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- figures arrive as data URLs */}
              <img
                src={figure}
                alt={`Figure ${index + 1}`}
                className="max-h-72 w-auto rounded-lg border border-border bg-white"
              />
            </a>
          ))}
        </div>
      ) : null}

      {run?.files.length ? (
        <ul className="mt-2 flex flex-col gap-1">
          {run.files.map((file) => (
            <li key={file.name}>
              <a
                href={file.dataUrl}
                download={file.name}
                className="text-accent hover:underline"
              >
                {file.name}
              </a>
              <span className="ml-1.5 text-muted-foreground">{sizeLabel(file.size)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Approval prompt for a tool that runs on the server (an MCP server or a custom
 * HTTP tool). Approving posts the decision; the chat stream then runs it.
 */
function ServerApprovalPanel({ call }: { call: ToolUsePart }) {
  const run = useUIStore((state) => state.toolRuns[call.id]);
  const patchToolRun = useUIStore((state) => state.patchToolRun);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const decide = async (decision: "run" | "deny") => {
    setBusy(true);
    setError(null);
    try {
      await api.postToolResult({ id: call.id, decision });
      patchToolRun(call.id, { status: decision === "run" ? "running" : "denied" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record your decision.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-3.5 shrink-0 text-accent" />
        <span className="font-medium">Run {run?.label ?? humanise(call.name)}?</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">Runs on the server with your saved settings.</span>
      </div>
      {summariseInput(call.input) ? (
        <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-secondary/60 p-2 text-[11px]">
          {JSON.stringify(call.input ?? {}, null, 2)}
        </pre>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide("run")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          <Play className="size-3" />
          Run
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide("deny")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-muted-foreground hover:bg-secondary disabled:opacity-60"
        >
          <X className="size-3" />
          Skip
        </button>
      </div>
      {error ? <p className="mt-1.5 text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}

/** Collapsible cards for the tool calls a model made while answering. */
export function ToolCallList({ content }: { content: ContentPart[] }) {
  const calls = content.filter((part): part is ToolUsePart => part.kind === "tool_use");
  const results = new Map(
    content.filter((part): part is ToolResultPart => part.kind === "tool_result").map((part) => [part.id, part])
  );

  if (!calls.length) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {calls.map((call) => {
        const result = results.get(call.id);
        const status = call.status ?? (result ? (result.isError ? "error" : "success") : "running");

        if (CLIENT_TOOLS.has(call.name)) {
          return <CodeRunPanel key={call.id} call={{ ...call, status }} />;
        }

        if (status === "awaiting_approval") {
          return <ServerApprovalPanel key={call.id} call={{ ...call, status }} />;
        }

        return (
          <details
            key={call.id}
            className={cn(
              "group rounded-xl border bg-card/60 px-3 py-2 text-xs",
              status === "error" ? "border-destructive/40" : "border-border"
            )}
          >
            <summary className="flex cursor-pointer list-none items-center gap-2">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              {status === "running" ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : status === "error" ? (
                <TriangleAlert className="size-3.5 shrink-0 text-destructive" />
              ) : (
                <Check className="size-3.5 shrink-0 text-accent" />
              )}
              <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">{humanise(call.name)}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{summariseInput(call.input)}</span>
            </summary>

            <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
              <div>
                <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Input</p>
                <pre className="max-h-40 overflow-auto rounded-lg bg-secondary/50 p-2 text-[11px]">
                  {JSON.stringify(call.input ?? {}, null, 2)}
                </pre>
              </div>
              {result ? (
                <div>
                  <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {result.isError ? "Error" : "Result"}
                  </p>
                  <pre
                    className={cn(
                      "max-h-56 overflow-auto rounded-lg p-2 text-[11px]",
                      result.isError ? "bg-destructive/10 text-destructive" : "bg-secondary/50"
                    )}
                  >
                    {result.output}
                  </pre>
                </div>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** "Sources" list built from the citations a tool reported. */
export function CitationList({ citations }: { citations: { title: string; url: string }[] }) {
  const unique = React.useMemo(() => {
    const seen = new Set<string>();
    return citations.filter((citation) => {
      if (!citation.url || seen.has(citation.url)) return false;
      seen.add(citation.url);
      return true;
    });
  }, [citations]);

  if (!unique.length) return null;

  return (
    <div className="rounded-xl border border-border bg-card/50 px-3 py-2">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Sources</p>
      <ol className="flex flex-col gap-0.5 text-xs">
        {unique.slice(0, 8).map((citation, index) => (
          <li key={citation.url} className="flex gap-1.5">
            <span className="text-muted-foreground">{index + 1}.</span>
            <a
              href={citation.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-accent hover:underline"
              title={citation.url}
            >
              {citation.title || citation.url}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}