"use client";

import { api } from "@/lib/api-client";
import { useUIStore, type ToolRunFile, type ToolRunState } from "@/lib/store/ui-store";
import { useChatStore } from "@/lib/store/chat-store";

/**
 * Runs the tools that execute in the browser (Python via Pyodide, JavaScript in
 * a worker) and posts the outcome back to the waiting chat stream.
 *
 * The chat route parks the call in lib/server/pending-tools.ts and streams a
 * `tool_approval` event; everything below happens on the user's machine, so the
 * code and its data never reach the server unless the model asks for them.
 */

const PYTHON_TIMEOUT_MS = 300_000;
const JS_TIMEOUT_MS = 60_000;

interface WorkerDone {
  result?: string;
  failure?: string | null;
  figures?: string[];
  files?: Array<{ name: string; size?: number; base64: string }>;
  stdout?: string;
  durationMs?: number;
}

function mimeFor(name: string): string {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const known: Record<string, string> = {
    csv: "text/csv",
    json: "application/json",
    txt: "text/plain",
    md: "text/markdown",
    py: "text/x-python",
    js: "text/javascript",
    html: "text/html",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    zip: "application/zip",
  };
  return known[extension] ?? "application/octet-stream";
}

function toRunFiles(raw: WorkerDone["files"]): ToolRunFile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((file) => file && typeof file.base64 === "string" && typeof file.name === "string")
    .map((file) => ({
      name: file.name,
      size: typeof file.size === "number" ? file.size : Math.floor((file.base64.length * 3) / 4),
      mime: mimeFor(file.name),
      dataUrl: `data:${mimeFor(file.name)};base64,${file.base64}`,
    }));
}

function figureUrls(figures: WorkerDone["figures"]): string[] {
  if (!Array.isArray(figures)) return [];
  return figures.filter((figure) => typeof figure === "string").map((figure) => `data:image/png;base64,${figure}`);
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The text the model receives as the tool result. */
function describeRun(run: ToolRunState, done: WorkerDone | null, failure: string | null): string {
  const sections: string[] = [];
  if (run.stdout.trim()) sections.push(`stdout:\n${run.stdout.trimEnd()}`);
  if (run.stderr.trim()) sections.push(`stderr:\n${run.stderr.trimEnd()}`);
  if (done?.result) sections.push(`result: ${done.result}`);
  if (run.figures.length) sections.push(`figures: ${run.figures.length} plot(s) rendered for the user.`);
  if (run.files.length) {
    sections.push(
      `files: ${run.files.map((file) => `${file.name} (${sizeLabel(file.size)}, downloadable)`).join(", ")}`
    );
  }
  if (failure) sections.push(`error:\n${failure}`);
  if (!sections.length) return "The code ran and produced no output.";
  return sections.join("\n\n");
}

function patch(id: string, update: Partial<ToolRunState>) {
  useUIStore.getState().patchToolRun(id, update);
}

async function postOutcome(id: string, output: string, isError: boolean) {
  try {
    await api.postToolResult({ id, chatId: useChatStore.getState().chatId ?? "", output, isError });
  } catch (error) {
    // The stream may have ended (timeout, reload, cancel); nothing else to do.
    console.warn("Conduit: could not deliver the tool result.", error);
  }
}

function runWorker(
  url: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
  onMessage: (message: { type: string; [key: string]: unknown }) => void
): Promise<void> {
  return new Promise((resolve) => {
    const worker = new Worker(url);
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve();
    };

    const timer = setTimeout(() => {
      onMessage({ type: "timeout" });
      finish();
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as { type: string; [key: string]: unknown };
      onMessage(message);
      if (message.type === "done" || message.type === "error") finish();
    };

    worker.onerror = (event) => {
      onMessage({ type: "error", message: event.message || "The worker failed to start." });
      finish();
    };

    worker.postMessage(payload);
  });
}

/** Runs one parked tool call. Safe to call twice: the second call is ignored. */
export async function runToolInBrowser(id: string): Promise<void> {
  const run = useUIStore.getState().toolRuns[id];
  if (!run || run.status === "running" || run.status === "done") return;

  const started = Date.now();
  patch(id, { status: "running", stdout: "", stderr: "", error: undefined, note: undefined });

  const isPython = run.name === "run_python";
  const code = (() => {
    const input = run.input as { code?: unknown } | null | undefined;
    return typeof input?.code === "string" ? input.code : "";
  })();

  if (!code.trim()) {
    patch(id, { status: "error", error: "The model did not send any code." });
    await postOutcome(id, "No code was provided.", true);
    return;
  }

  let failure: string | null = null;
  let done: WorkerDone | null = null;

  await runWorker(
    isPython ? "/code-workers/python-worker.js" : "/code-workers/js-worker.js",
    { id, code },
    isPython ? PYTHON_TIMEOUT_MS : JS_TIMEOUT_MS,
    (message) => {
      const current = useUIStore.getState().toolRuns[id] ?? run;
      if (message.type === "stdout") {
        patch(id, { stdout: current.stdout + String(message.text ?? "") });
        return;
      }
      if (message.type === "stderr") {
        patch(id, { stderr: current.stderr + String(message.text ?? "") });
        return;
      }
      if (message.type === "status") {
        patch(id, { note: String(message.message ?? "") });
        return;
      }
      if (message.type === "error") {
        failure = String(message.message ?? "The worker failed.");
        return;
      }
      if (message.type === "timeout") {
        failure = isPython
          ? "Python ran for five minutes and was stopped. The interpreter restarted."
          : "The script ran for a minute and was stopped.";
        return;
      }
      if (message.type === "done") {
        done = message as WorkerDone;
        if (done.stdout) patch(id, { stdout: [useUIStore.getState().toolRuns[id]?.stdout ?? "", done.stdout].filter(Boolean).join("\n") });
        if (done.failure) failure = done.failure;
        patch(id, {
          result: done.result ?? "",
          figures: figureUrls(done.figures),
          files: toRunFiles(done.files),
          durationMs: typeof done.durationMs === "number" ? done.durationMs : Date.now() - started,
        });
      }
    }
  );

  const latest = useUIStore.getState().toolRuns[id] ?? run;
  const output = describeRun(latest, done, failure);
  patch(id, {
    status: failure ? "error" : "done",
    error: failure ?? undefined,
    note: undefined,
    durationMs: latest.durationMs ?? Date.now() - started,
  });
  await postOutcome(id, output, Boolean(failure));
}

/** Declines a parked tool call; the model is told and carries on. */
export async function denyToolInBrowser(id: string): Promise<void> {
  patch(id, { status: "denied", error: "Declined by the user." });
  try {
    await api.postToolResult({ id, chatId: useChatStore.getState().chatId ?? "", decision: "deny" });
  } catch (error) {
    console.warn("Conduit: could not deliver the tool decision.", error);
  }
}