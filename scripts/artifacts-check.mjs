/**
 * Artifact and image-routing checks (Milestones 4 and 5).
 *
 * Requires the app (`npm run dev`) and the mock provider
 * (`node scripts/mock-provider.mjs`) to be running.
 *
 *   node scripts/artifacts-check.mjs [appUrl] [providerBaseUrl]
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const appUrl = process.argv[2] ?? "http://localhost:3000";
const providerBaseUrl = process.argv[3] ?? "http://127.0.0.1:4123/v1";

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
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

/** Streams a chat turn; returns the concatenated text or the error envelope. */
async function streamChat(payload) {
  const response = await fetch(`${appUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    const raw = await response.text();
    let message = `status ${response.status}`;
    try {
      message = JSON.parse(raw).error ?? message;
    } catch {
      /* keep the status-only message */
    }
    return { ok: false, status: response.status, message, text: "" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let chatId = null;

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
    }
  }
  return { ok: true, status: response.status, chatId, text };
}

/* --- provider + model setup (mock) --------------------------------------- */

const health = await jsonFetch("/api/health");
check("health endpoint responds", health.status === 200, `database: ${health.body?.database?.reachable}`);

const created = await jsonFetch("/api/providers", {
  method: "POST",
  body: JSON.stringify({
    name: "Mock Artifacts",
    baseUrl: providerBaseUrl,
    apiFormat: "openai-completions",
    apiKey: "test-key",
  }),
});
const providerId = created.body?.provider?.id;
check("mock provider created", created.status === 201 && Boolean(providerId), providerId ?? created.body?.error);

const discovered = await jsonFetch(`/api/providers/${providerId}/models`, {
  method: "POST",
  body: JSON.stringify({ discover: true }),
});
const modelId = discovered.body?.models?.[0]?.id;
check("models discovered", Boolean(modelId), `${discovered.body?.models?.length ?? 0} models`);

const patched = await jsonFetch(`/api/models/${modelId}`, {
  method: "PATCH",
  body: JSON.stringify({ isDefault: true, capabilities: { toolCalling: true, vision: false } }),
});
check("default model set (vision off)", patched.status === 200 && patched.body?.model?.isDefault === true);

/* --- M5: artifacts -------------------------------------------------------- */

const first = await streamChat({ message: "Please show me an artifact", modelId });
check("artifact block streamed", first.ok && /<artifact\b/.test(first.text), `${first.text.length} chars`);

const chatId = first.chatId;
const listed = await jsonFetch(`/api/artifacts?chatId=${chatId}`);
const artifacts = listed.body?.artifacts ?? [];
check(
  "artifact captured and typed",
  listed.status === 200 && artifacts.length === 1 && artifacts[0].type === "html",
  `${artifacts.length} artifact(s)`
);
check("first emission is version one", artifacts[0]?.versionCount === 1, String(artifacts[0]?.versionCount));

const second = await streamChat({ chatId, message: "Another artifact please", modelId });
check("second artifact block streamed", second.ok && /<artifact\b/.test(second.text));

const listed2 = await jsonFetch(`/api/artifacts?chatId=${chatId}`);
const latest = listed2.body?.artifacts?.[0];
check("same identifier becomes version two", latest?.versionCount === 2, String(latest?.versionCount));

const detail = await jsonFetch(`/api/artifacts/${latest.id}`);
const versions = detail.body?.versions ?? [];
check(
  "version history is returned oldest-first",
  detail.status === 200 && versions.length === 2 && versions[0].version === 1 && versions[1].version === 2,
  versions.map((version) => `v${version.version}`).join(", ")
);
check(
  "versions differ so the diff view has content",
  versions.length === 2 && versions[0].content !== versions[1].content
);
check(
  "artifact rows are attributed to their chat",
  versions.every((version) => version.chatId === chatId)
);

/* --- M4: image routing ---------------------------------------------------- */

const blocked = await streamChat({
  chatId,
  modelId,
  message: [
    { kind: "image", dataUrl: PNG_1X1, alt: "pixel" },
    { kind: "text", text: "What is in this image?" },
  ],
});
check(
  "image rejected for a non-vision model",
  blocked.ok === false && blocked.status === 409 && /vision/i.test(blocked.message),
  blocked.message.slice(0, 70)
);

await jsonFetch(`/api/models/${modelId}`, {
  method: "PATCH",
  body: JSON.stringify({ capabilities: { toolCalling: true, vision: true } }),
});
const allowed = await streamChat({
  chatId,
  modelId,
  message: [
    { kind: "image", dataUrl: PNG_1X1, alt: "pixel" },
    { kind: "text", text: "Now describe it" },
  ],
});
check("image accepted once the model is vision-capable", allowed.ok && allowed.text.length > 0, `${allowed.text.length} chars`);

/* --- M4: uploaded attachments are linked to their message ---------------- */

const form = new FormData();
form.append(
  "file",
  new File([Buffer.from(PNG_1X1.split(",")[1], "base64")], "pixel.png", { type: "image/png" })
);
const uploadResponse = await fetch(`${appUrl}/api/files`, { method: "POST", body: form });
const uploaded = (await uploadResponse.json()).file;

const linked = await streamChat({
  chatId,
  modelId,
  message: [
    { kind: "image", dataUrl: uploaded.dataUrl, alt: uploaded.name, attachmentId: uploaded.id },
    { kind: "text", text: "This image was uploaded first" },
  ],
});

const Database = require("better-sqlite3");
// Honour SQLITE_PATH so the check can run against a scratch database.
const dbPath = process.env.SQLITE_PATH?.trim() || "data/conduit.db";
const db = new Database(dbPath, { readonly: true });
const row = db.prepare("select chat_id, message_id from attachments where id = ?").get(uploaded.id);
db.close();

check("uploaded attachment is stored", uploadResponse.status === 201 && Boolean(uploaded?.id));
check("image with an attachment id is accepted", linked.ok && linked.text.length > 0);
check(
  "attachment row is linked to its chat and message",
  Boolean(row?.chat_id) && Boolean(row?.message_id) && row.chat_id === chatId,
  row ? `${row.chat_id ?? "null"} / ${row.message_id ?? "null"}` : "no row"
);

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} artifact checks passed`);
process.exitCode = failed ? 1 : 0;
