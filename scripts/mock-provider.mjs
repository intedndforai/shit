/**
 * A tiny OpenAI-compatible mock provider.
 *
 * Used by `npm run smoke` (and by anyone hacking on Conduit without burning
 * real tokens). It implements the two endpoints Conduit needs:
 *
 *   GET  /v1/models
 *   POST /v1/chat/completions   (SSE streaming)
 *
 * Run: node scripts/mock-provider.mjs [port]
 */

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4123);

const MODELS = [
  { id: "mock-small", object: "model", owned_by: "conduit-mock", context_length: 8192 },
  { id: "mock-large", object: "model", owned_by: "conduit-mock", context_length: 128000 },
];

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Escapes text so the artifact payload stays well-formed HTML. */
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

let artifactRevision = 0;

function reply(history) {
  const lastUser = [...history].reverse().find((message) => message.role === "user");
  const question =
    typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content.map((part) => part.text ?? "").join(" ")
        : "";

  if (/artifact/i.test(question)) {
    artifactRevision += 1;
    return [
      "Here is a self-contained panel you can preview in the artifacts panel.",
      "",
      '<artifact identifier="mock-panel" type="html" title="Mock panel">',
      '<div style="font:16px system-ui,sans-serif;padding:8px">',
      `  <h1 style="margin:0 0 8px">Revision ${artifactRevision}</h1>`,
      `  <p style="margin:0">Requested with: ${escapeHtml(question.trim())}</p>`,
      "</div>",
      "</artifact>",
      "",
      "Ask for an artifact again to see a new version and diff it.",
    ].join("\n");
  }

  return `You said: "${question.trim()}". This reply streamed token by token from the local mock provider, which proves Conduit's adapter, streaming, and persistence layers all work end to end.`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    json(res, 200, { object: "list", data: MODELS });
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        json(res, 400, { error: { message: "Invalid JSON body." } });
        return;
      }

      const text = reply(body.messages ?? []);
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });

      const words = text.split(" ");
      let index = 0;

      const timer = setInterval(() => {
        if (index < words.length) {
          const chunk = {
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            model: body.model ?? "mock-small",
            choices: [{ index: 0, delta: { content: `${index === 0 ? "" : " "}${words[index]}` } }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          index += 1;
          return;
        }

        clearInterval(timer);
        const finalChunk = {
          id: "chatcmpl-mock",
          object: "chat.completion.chunk",
          model: body.model ?? "mock-small",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 24, completion_tokens: words.length, total_tokens: 24 + words.length },
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }, 25);

      // Node emits "close" on a fully-consumed request; use the response stream
      // to detect a client disconnect instead.
      res.on("close", () => clearInterval(timer));
    });
    return;
  }

  json(res, 404, { error: { message: `No route for ${req.method} ${url.pathname}` } });
});

server.listen(port, () => {
  console.log(`mock provider listening on http://127.0.0.1:${port}/v1`);
});