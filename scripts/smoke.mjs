/**
 * End-to-end smoke test for Milestone 2.
 *
 * Requires the app (`npm run dev`) and the mock provider
 * (`node scripts/mock-provider.mjs`) to be running.
 *
 *   node scripts/smoke.mjs [appUrl] [providerBaseUrl]
 */

const appUrl = process.argv[2] ?? "http://localhost:3000";
const providerBaseUrl = process.argv[3] ?? "http://127.0.0.1:4123/v1";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function jsonFetch(path, init) {
  const response = await fetch(`${appUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

// 1. Health
const health = await jsonFetch("/api/health");
check("health endpoint responds", health.status === 200, `database reachable: ${health.body?.database?.reachable}`);

// 2. Create provider
const created = await jsonFetch("/api/providers", {
  method: "POST",
  body: JSON.stringify({
    name: "Mock Local",
    baseUrl: providerBaseUrl,
    apiFormat: "openai-completions",
    apiKey: "test-key",
  }),
});
const providerId = created.body?.provider?.id;
check("provider created", created.status === 201 && Boolean(providerId), providerId ?? JSON.stringify(created.body));
check(
  "api key is masked in responses",
  created.body?.provider?.hasApiKey === true && !JSON.stringify(created.body).includes("test-key"),
  created.body?.provider?.maskedApiKey
);

// 3. Test connection
const tested = await jsonFetch(`/api/providers/${providerId}/test`, { method: "POST", body: "{}" });
check("connection test succeeds", tested.status === 200, `models visible: ${tested.body?.models}`);

// 4. Discover models
const discovered = await jsonFetch(`/api/providers/${providerId}/models`, {
  method: "POST",
  body: JSON.stringify({ discover: true }),
});
const modelId = discovered.body?.models?.[0]?.id;
check("models discovered and stored", Array.isArray(discovered.body?.models) && discovered.body.models.length >= 2, `${discovered.body?.models?.length} models`);

// 5. Make a model the default
const patched = await jsonFetch(`/api/models/${modelId}`, {
  method: "PATCH",
  body: JSON.stringify({ isDefault: true, capabilities: { toolCalling: true } }),
});
check("default model set", patched.status === 200 && patched.body?.model?.isDefault === true, patched.body?.model?.externalId);

// 6. Stream a chat completion
const streamResponse = await fetch(`${appUrl}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ message: "Hello Conduit" }),
});

check("chat stream opens", streamResponse.status === 200 && Boolean(streamResponse.body), `status ${streamResponse.status}`);

const reader = streamResponse.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let text = "";
let chatId = null;
let sawUsage = false;
let sawDone = false;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  let index = buffer.indexOf("\n\n");
  while (index !== -1) {
    const chunk = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 2);
    index = buffer.indexOf("\n\n");
    if (!chunk.startsWith("data:")) continue;

    const event = JSON.parse(chunk.slice(5).trim());
    if (event.type === "chat") chatId = event.chatId;
    if (event.type === "text_delta") text += event.text;
    if (event.type === "usage") sawUsage = true;
    if (event.type === "done") sawDone = true;
  }
}

check("streamed text received", text.length > 20, `${text.length} chars`);
check("stream signalled done", sawDone);
check("usage reported", sawUsage);

// 7. Persistence
const chats = await jsonFetch("/api/chats");
check("chat persisted", chats.status === 200 && chats.body.chats.length >= 1, `${chats.body?.chats?.length} chat(s)`);

const detail = await jsonFetch(`/api/chats/${chatId}`);
const roles = (detail.body?.messages ?? []).map((message) => message.role);
const assistantText = (detail.body?.messages ?? [])
  .filter((message) => message.role === "assistant")
  .flatMap((message) => message.content ?? [])
  .filter((part) => part.kind === "text")
  .map((part) => part.text)
  .join("");

check("user + assistant messages stored", roles.includes("user") && roles.includes("assistant"), roles.join(","));
check("assistant text matches the stream", assistantText.length > 20 && text.includes(assistantText.slice(0, 20)));
check("generated title stored", Boolean(detail.body?.chat?.title), detail.body?.chat?.title);

// 8. Regenerate the last answer (same chat, no new user turn)
const beforeCount = (detail.body?.messages ?? []).length;
const regenResponse = await fetch(`${appUrl}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ chatId, regenerate: true }),
});
let regenText = "";
if (regenResponse.ok && regenResponse.body) {
  const regenReader = regenResponse.body.getReader();
  let regenBuffer = "";
  while (true) {
    const { done, value } = await regenReader.read();
    if (done) break;
    regenBuffer += decoder.decode(value, { stream: true });
    let index = regenBuffer.indexOf("\n\n");
    while (index !== -1) {
      const chunk = regenBuffer.slice(0, index).trim();
      regenBuffer = regenBuffer.slice(index + 2);
      index = regenBuffer.indexOf("\n\n");
      if (!chunk.startsWith("data:")) continue;
      const event = JSON.parse(chunk.slice(5).trim());
      if (event.type === "text_delta") regenText += event.text;
    }
  }
}

const after = await jsonFetch(`/api/chats/${chatId}`);
const afterRoles = (after.body?.messages ?? []).map((message) => message.role);
check("regenerate produced a new answer", regenText.length > 20, `${regenText.length} chars`);
check(
  "regenerate did not duplicate the user turn",
  after.body?.messages?.length === beforeCount,
  `messages before ${beforeCount}, after ${after.body?.messages?.length}`
);
check("regenerate stored the new assistant answer", afterRoles.filter((role) => role === "assistant").length === 1);

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);