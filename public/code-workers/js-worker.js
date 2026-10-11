/**
 * JavaScript sandbox for the "Run JavaScript" tool.
 *
 * A worker is a separate global with no DOM and no access to the page, so the
 * code cannot touch the app. Network access is explicitly removed below: fetch,
 * XHR, WebSocket, EventSource and importScripts all throw. The main thread
 * terminates this worker on timeout, which also kills any runaway loop.
 */

const MAX_LOG_CHARS = 20000;

function format(value, seen = new Set()) {
  if (typeof value === "string") return value;
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "bigint") return `${value}n`;
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => format(item, seen)).join(", ")}]`;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    const entries = Object.entries(value).map(([key, item]) => `${key}: ${format(item, seen)}`);
    return `{${entries.join(", ")}}`;
  } catch {
    return "[unprintable]";
  } finally {
    seen.delete(value);
  }
}

function blocked(name) {
  return function refuse() {
    throw new Error(`${name} is disabled inside the sandbox.`);
  };
}

self.fetch = blocked("fetch");
self.XMLHttpRequest = blocked("XMLHttpRequest");
self.WebSocket = blocked("WebSocket");
self.EventSource = blocked("EventSource");
self.importScripts = blocked("importScripts");
self.navigator = undefined;

self.onmessage = async (event) => {
  const data = event.data || {};
  if (!data.id || typeof data.code !== "string") return;
  const id = data.id;

  const lines = [];
  let truncated = false;
  const write = (level, parts) => {
    if (truncated) return;
    const line = parts.map((part) => format(part)).join(" ");
    lines.push(level === "log" ? line : `[${level}] ${line}`);
    if (lines.join("\n").length > MAX_LOG_CHARS) {
      truncated = true;
      lines.push("[output truncated]");
    }
  };

  const sandboxConsole = {
    log: (...parts) => write("log", parts),
    info: (...parts) => write("info", parts),
    debug: (...parts) => write("debug", parts),
    warn: (...parts) => write("warn", parts),
    error: (...parts) => write("error", parts),
    table: (...parts) => write("log", parts),
  };

  let result = "";
  let failure = null;
  const started = Date.now();
  try {
    const runner = new Function(
      "console",
      `"use strict";\nreturn (async () => {\n${data.code}\n})();`
    );
    const value = await runner(sandboxConsole);
    result = value === undefined ? "" : format(value);
  } catch (error) {
    failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  self.postMessage({
    id,
    type: "done",
    stdout: lines.join("\n"),
    result,
    failure,
    durationMs: Date.now() - started,
  });
};