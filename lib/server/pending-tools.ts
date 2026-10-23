/**
 * Bridge for tools that execute in the browser.
 *
 * A running SSE stream cannot receive a message from the page, so the chat route
 * parks the pending tool call here and the browser posts the outcome back to
 * `POST /api/chat/tool-result`. State hangs off `globalThis` because Next.js
 * compiles each route handler into its own module instance, so a module-level
 * Map would not be visible from the other route.
 *
 * Security: a pending call is bound to the chat that created it. Settling it
 * requires BOTH the tool-call id and the owning chat id, so a request that only
 * guesses or observes the id cannot resolve someone else's call. The route adds
 * two more gates (cross-site refusal, JSON content type) on top of this.
 */

/**
 * How long a parked tool call waits for the page before it is treated as an
 * expired approval. Override with PENDING_TOOL_TTL_MS (milliseconds); the
 * default is 10 minutes and the value never drops below 1 second.
 */
const configuredToolTtlMs = Number(process.env.PENDING_TOOL_TTL_MS);
export const CLIENT_TOOL_TIMEOUT_MS = Number.isFinite(configuredToolTtlMs)
  ? Math.max(1000, Math.floor(configuredToolTtlMs))
  : 600000;

export type ClientToolOutcome =
  | { status: "ok"; output: string; isError: boolean }
  | { status: "denied"; reason?: string }
  | { status: "cancelled" };

interface PendingEntry {
  /** The chat that owns this pending call. Must match to settle it. */
  chatId: string;
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
  options: { chatId: string; signal?: AbortSignal; timeoutMs?: number }
): Promise<ClientToolOutcome> {
  const { signal, timeoutMs = CLIENT_TOOL_TIMEOUT_MS } = options;
  const chatId = options.chatId;
  if (!chatId) throw new Error("waitForClientTool requires the owning chat id.");
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

    // Expiry resolves through the same settle path as an explicit deny, so the
    // tool loop continues and the stream finishes with a clear reason.
    const timer = setTimeout(
      () => finish({ status: "denied", reason: "Tool approval expired - no response was received." }),
      timeoutMs
    );
    const onAbort = () => finish({ status: "cancelled" });

    if (signal?.aborted) {
      finish({ status: "cancelled" });
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    pending.set(id, { chatId, settle: finish });
  });
}

/** Called by the browser once the tool ran (or failed). False if unknown or not this chat's call. */
export function resolveClientTool(
  id: string,
  payload: { output: string; isError: boolean },
  chatId: string
): boolean {
  const entry = registry().get(id);
  // Unknown ids and chat mismatches are deliberately indistinguishable.
  if (!entry || entry.chatId !== chatId) return false;
  entry.settle({ status: "ok", output: payload.output, isError: payload.isError });
  return true;
}

/** Called when the user declines the approval prompt. False if unknown or not this chat's call. */
export function denyClientTool(id: string, chatId: string): boolean {
  const entry = registry().get(id);
  if (!entry || entry.chatId !== chatId) return false;
  entry.settle({ status: "denied" });
  return true;
}