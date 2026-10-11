/**
 * Bridge for tools that execute in the browser.
 *
 * A running SSE stream cannot receive a message from the page, so the chat route
 * parks the pending tool call here and the browser posts the outcome back to
 * `POST /api/chat/tool-result`. State hangs off `globalThis` because Next.js
 * compiles each route handler into its own module instance, so a module-level
 * Map would not be visible from the other route.
 */

export const CLIENT_TOOL_TIMEOUT_MS = 10 * 60 * 1000;

export type ClientToolOutcome =
  | { status: "ok"; output: string; isError: boolean }
  | { status: "denied" }
  | { status: "cancelled" }
  | { status: "timeout" };

interface PendingEntry {
  settle: (outcome: ClientToolOutcome) => void;
}

const KEY = "__conduitPendingClientTools";

function registry(): Map<string, PendingEntry> {
  const scope = globalThis as typeof globalThis & { [KEY]?: Map<string, PendingEntry> };
  scope[KEY] ??= new Map<string, PendingEntry>();
  return scope[KEY];
}

/** Waits for the page to run the tool. Never rejects: the outcome says what happened. */
export function waitForClientTool(
  id: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ClientToolOutcome> {
  const { signal, timeoutMs = CLIENT_TOOL_TIMEOUT_MS } = options;
  const pending = registry();

  return new Promise<ClientToolOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: ClientToolOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      pending.delete(id);
      resolve(outcome);
    };

    const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs);
    const onAbort = () => finish({ status: "cancelled" });

    if (signal?.aborted) {
      finish({ status: "cancelled" });
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    pending.set(id, { settle: finish });
  });
}

/** Called by the browser once the tool ran (or failed). Returns false if the call went stale. */
export function resolveClientTool(id: string, payload: { output: string; isError: boolean }): boolean {
  const entry = registry().get(id);
  if (!entry) return false;
  entry.settle({ status: "ok", output: payload.output, isError: payload.isError });
  return true;
}

/** Called when the user declines the approval prompt. */
export function denyClientTool(id: string): boolean {
  const entry = registry().get(id);
  if (!entry) return false;
  entry.settle({ status: "denied" });
  return true;
}