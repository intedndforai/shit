/**
 * A tiny OpenAI-compatible mock provider.
 *
 * Used by `npm run smoke` (and by anyone hacking on Conduit without burning
 * real tokens). It implements the two endpoints Conduit needs:
 *
 *   GET  /v1/models
 *   POST /v1/chat/completions   (SSE streaming, with tool calls)
 *
 * Behaviour hints:
 *   - "artifact" in the prompt  → streams an <artifact> HTML block (revision n)
 *   - "calculate" in the prompt → asks for the calculator tool, then answers
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

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => (typeof part === "string" ? part : (part.text ?? part.output ?? "")))
      .join(" ");
  }
  return "";
}

/**
 * Deterministic bag-of-words embedding: identical text yields an identical
 * vector, and texts that share words point in a similar direction. That is
 * enough to exercise the vector retrieval path end to end.
 */
function embed(text, dimensions = 32) {
  const vector = new Array(dimensions).fill(0);
  const tokens = String(text).toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  for (const token of tokens) {
    let hash = 0;
    for (let index = 0; index < token.length; index += 1) {
      hash = (hash * 31 + token.charCodeAt(index)) % 100000;
    }
    vector[hash % dimensions] += 1;
  }
  const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

let artifactRevision = 0;

function plainReply(question) {
  return `You said: "${question.trim()}". This reply streamed token by token from the local mock provider, which proves Conduit's adapter, streaming, and persistence layers all work end to end.`;
}

function artifactReply(question) {
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

/** Name of the tool the assistant asked for in the previous round. */
function lastToolName(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const calls = messages[index]?.tool_calls;
    if (Array.isArray(calls) && calls.length && calls[0]?.function?.name) return calls[0].function.name;
  }
  return null;
}

/** Returns the frames to stream plus the text (for usage accounting). */
function buildFrames(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  const question = messageText(last);
  const toolResults = messages.filter((message) => message.role === "tool");
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const systemText = messages
    .filter((message) => message.role === "system")
    .map(messageText)
    .join("\n");

  // Second pass: the model has the tool output and answers with prose.
  if (toolResults.length) {
    const output = toolResults
      .map((message) => messageText(message))
      .join("\n")
      .trim();
    const toolName = lastToolName(messages) ?? "The tool";
    const text = `${toolName} returned ${output}. (Mock provider: this is a real tool round-trip through Conduit.)`;
    return { frames: text.split(" ").map((word, index) => ({ content: `${index === 0 ? "" : " "}${word}` })), text };
  }

  // First pass: obey the tool contract when the prompt asks for arithmetic.
  if (hasTools && /calculate/i.test(question)) {
    return {
      frames: [
        { tool_calls: [{ index: 0, id: "call_mock_1", function: { name: "calculator", arguments: '{"expression":' } }] },
        { tool_calls: [{ index: 0, function: { arguments: '"21*2"}' } }] },
      ],
      text: "",
      finishReason: "tool_calls",
    };
  }

  if (hasTools && /python|multiply|code/i.test(question)) {
    return {
      frames: [
        { tool_calls: [{ index: 0, id: "call_mock_py", function: { name: "run_python", arguments: '{"code":' } }] },
        { tool_calls: [{ index: 0, function: { arguments: '"print(21 * 2)"}' } }] },
      ],
      text: "",
      finishReason: "tool_calls",
    };
  }

  if (hasTools && /convert/i.test(question)) {
    return {
      frames: [
        {
          tool_calls: [
            {
              index: 0,
              id: "call_mock_convert",
              function: { name: "convert_units", arguments: '{"value":26.2,"from":"mi","to":"km"}' },
            },
          ],
        },
      ],
      text: "",
      finishReason: "tool_calls",
    };
  }

  // The server layers the profile, memory, and response style onto the system
  // prompt. These markers (only produced when the question says "marker-check")
  // prove each layer reached the model.
  if (/memory-protocol-check/i.test(question)) {
    const text = /durable facts about the user across chats/i.test(systemText)
      ? "memory-protocol-applied"
      : "memory-protocol-missing";
    return { frames: text.split(" ").map((word, index) => ({ content: (index === 0 ? "" : " ") + word })), text };
  }

  if (/marker-check/i.test(question)) {
    const marker = /Response style:/i.test(systemText)
      ? "style-marker-applied"
      : /Things you remember about this user/i.test(systemText)
        ? "memory-marker-recalled"
        : /How they want you to respond:/i.test(systemText)
          ? "profile-marker-applied"
          : null;
    if (marker) {
      const text = marker + " " + plainReply(question);
      return {
        frames: text.split(" ").map((word, index) => ({ content: (index === 0 ? "" : " ") + word })),
        text,
      };
    }
  }

  // "remember" makes the model propose a fact with a <memory> block, which the
  // server stores and strips from the transcript.
  if (/remember/i.test(question)) {
    const text = [
      "Noted.",
      "<memory>The user prefers short, direct answers.</memory>",
      "Anything else you want me to hold on to?",
    ].join("\n");
    return {
      frames: text.split(" ").map((word, index) => ({ content: (index === 0 ? "" : " ") + word })),
      text,
    };
  }

  // A question about the project knowledge base: the server injects the matching
  // excerpts into the system prompt, so echoing the marker proves retrieval ran.
  if (/kb-marker-7/i.test(systemText)) {
    const text = "I found kb-marker-7 in the project knowledge base excerpt you gave me.";
    return {
      frames: text.split(" ").map((word, index) => ({ content: (index === 0 ? "" : " ") + word })),
      text,
    };
  }

  // "think" asks for a reasoning trace first, so the Thinking panel has something to show.
  if (/think|reason/i.test(question)) {
    const reply = plainReply(question);
    return {
      frames: [
        ..."Let me work through the question step by step.".split(" ").map((word, index) => ({
          reasoning_content: `${index === 0 ? "" : " "}${word}`,
        })),
        ...reply.split(" ").map((word, index) => ({ content: `${index === 0 ? "" : " "}${word}` })),
      ],
      text: reply,
    };
  }

  const text = /artifact/i.test(question) ? artifactReply(question) : plainReply(question);
  return {
    frames: text.split(" ").map((word, index) => ({ content: `${index === 0 ? "" : " "}${word}` })),
    text,
  };
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    json(res, 200, { object: "list", data: MODELS });
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/embeddings")) {
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
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ""];
      json(res, 200, {
        object: "list",
        model: body.model ?? "mock-embed",
        data: inputs.map((text, index) => ({ object: "embedding", index, embedding: embed(String(text)) })),
      });
    });
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

      const { frames, text, finishReason } = buildFrames(body);

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });

      let index = 0;
      const timer = setInterval(() => {
        if (index < frames.length) {
          const frame = frames[index];
          const delta =
            frame.reasoning_content !== undefined
              ? { reasoning_content: frame.reasoning_content }
              : frame.content !== undefined
                ? { content: frame.content }
                : { tool_calls: frame.tool_calls };
          const chunk = {
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            model: body.model ?? "mock-small",
            choices: [{ index: 0, delta }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          index += 1;
          return;
        }

        clearInterval(timer);
        const completionTokens = text ? text.split(" ").length : 4;
        const finalChunk = {
          id: "chatcmpl-mock",
          object: "chat.completion.chunk",
          model: body.model ?? "mock-small",
          choices: [{ index: 0, delta: {}, finish_reason: finishReason ?? "stop" }],
          usage: { prompt_tokens: 24, completion_tokens: completionTokens, total_tokens: 24 + completionTokens },
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }, 20);

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