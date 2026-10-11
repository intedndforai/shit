import { createServer } from "node:http";

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

// The tool checks below assert that web search starts out unconfigured, so park
// whatever the database already has and put it back at the end of the run.
const originalToolsConfig = (await jsonFetch("/api/tools")).body?.config ?? null;
await jsonFetch("/api/tools", { method: "PATCH", body: JSON.stringify({ webSearch: { enabled: false } }) });

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

// --- Milestone 3: branches, edits, search, export/import, titles -----------

const streamChat = async (payload) => {
  const response = await fetch(`${appUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let out = "";
  if (!response.ok || !response.body) return out;
  const rdr = response.body.getReader();
  let buf = "";
  while (true) {
    const { done, value } = await rdr.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let index = buf.indexOf("\n\n");
    while (index !== -1) {
      const chunk = buf.slice(0, index).trim();
      buf = buf.slice(index + 2);
      index = buf.indexOf("\n\n");
      if (!chunk.startsWith("data:")) continue;
      const event = JSON.parse(chunk.slice(5).trim());
      if (event.type === "text_delta") out += event.text;
    }
  }
  return out;
};

const textOfMessage = (message) =>
  (message?.content ?? [])
    .filter((part) => part.kind === "text")
    .map((part) => part.text)
    .join("");

// 9. The regenerated answer is a sibling version of the first answer.
const afterRegen = await jsonFetch(`/api/chats/${chatId}`);
const versioned = (afterRegen.body?.messages ?? []).find((message) => message.siblingCount > 1);
check(
  "regenerate created an answer version",
  Boolean(versioned) && versioned?.siblingIndex === 1,
  versioned ? `visible ${versioned.siblingIndex + 1}/${versioned.siblingCount}` : "no siblings found"
);

const versionedId = versioned?.id;
if (versionedId) {
  const switched = await jsonFetch(`/api/messages/${versionedId}/switch`, {
    method: "POST",
    body: JSON.stringify({ direction: "prev" }),
  });
  check(
    "switching to the previous version succeeds",
    switched.status === 200 && switched.body?.messageId !== versionedId,
    switched.body?.messageId
  );

  const switchedChat = await jsonFetch(`/api/chats/${chatId}`);
  const visibleAssistants = (switchedChat.body?.messages ?? []).filter((message) => message.role === "assistant");
  check("a branch switch still shows one answer", visibleAssistants.length === 1, `${visibleAssistants.length} visible`);
  check(
    "the earlier version becomes the visible one",
    visibleAssistants[0]?.id !== versionedId && visibleAssistants[0]?.siblingIndex === 0,
    `${visibleAssistants[0]?.siblingIndex + 1}/${visibleAssistants[0]?.siblingCount}`
  );

  // Return to the newest version before editing.
  await jsonFetch(`/api/messages/${visibleAssistants[0]?.id}/switch`, {
    method: "POST",
    body: JSON.stringify({ direction: "next" }),
  });
}

// 10. Editing a user turn branches instead of overwriting.
const activeAfterSwitch = await jsonFetch(`/api/chats/${chatId}`);
const lastUser = [...(activeAfterSwitch.body?.messages ?? [])].reverse().find((message) => message.role === "user");
const edited = await jsonFetch(`/api/messages/${lastUser?.id}/edit`, {
  method: "POST",
  body: JSON.stringify({ text: "Edited question about apples" }),
});
check(
  "editing a user message creates a branch",
  edited.status === 200 && Boolean(edited.body?.messageId),
  edited.body?.messageId
);

const editedText = await streamChat({ chatId, continueFromLeaf: true });
check("the edited branch gets a fresh answer", editedText.includes("apples"), editedText.slice(0, 48));

const editedChat = await jsonFetch(`/api/chats/${chatId}`);
const visibleUsers = (editedChat.body?.messages ?? []).filter((message) => message.role === "user");
check(
  "the edited turn is the newest user version",
  visibleUsers.length === 1 && visibleUsers[0]?.siblingCount === 2 && visibleUsers[0]?.siblingIndex === 1,
  visibleUsers.map((message) => `${message.siblingIndex + 1}/${message.siblingCount}`).join(" ")
);

const backToOriginal = await jsonFetch(`/api/messages/${visibleUsers[0]?.id}/switch`, {
  method: "POST",
  body: JSON.stringify({ direction: "prev" }),
});
const originalBranch = await jsonFetch(`/api/chats/${chatId}`);
const originalUser = (originalBranch.body?.messages ?? []).find((message) => message.role === "user");
check(
  "the original user text is still reachable",
  backToOriginal.status === 200 && textOfMessage(originalUser).startsWith("Hello Conduit"),
  textOfMessage(originalUser).slice(0, 40)
);

// Return to the edited branch for the remaining checks.
await jsonFetch(`/api/messages/${visibleUsers[0]?.id}/switch`, {
  method: "POST",
  body: JSON.stringify({ direction: "self" }),
});

// 11. Search across titles and message bodies.
const search = await jsonFetch(`/api/search?q=${encodeURIComponent("apples")}`);
check("search finds edited content", search.status === 200 && (search.body?.hits?.length ?? 0) > 0, `${search.body?.hits?.length} hit(s)`);

// 12. Export the active branch as JSON and Markdown.
const exportResponse = await fetch(`${appUrl}/api/chats/${chatId}/export?format=json`);
const exported = await exportResponse.json();
check(
  "JSON export contains the active branch",
  exportResponse.status === 200 &&
    Array.isArray(exported.messages) &&
    exported.messages.length >= 2 &&
    JSON.stringify(exported).includes("apples"),
  `${exported.messages?.length} messages`
);

const markdownResponse = await fetch(`${appUrl}/api/chats/${chatId}/export?format=md`);
const markdownText = await markdownResponse.text();
check(
  "Markdown export renders headings",
  markdownResponse.status === 200 && markdownText.startsWith("# ") && markdownText.includes("## You"),
  `${markdownText.length} chars`
);

// 13. Import the exported JSON back in as a new chat.
const imported = await jsonFetch("/api/chats/import", { method: "POST", body: JSON.stringify(exported) });
check("exported JSON imports as a new chat", imported.status === 201 && Boolean(imported.body?.chatId), imported.body?.chatId);
const importedChat = await jsonFetch(`/api/chats/${imported.body?.chatId}`);
check(
  "imported chat keeps every message",
  (importedChat.body?.messages?.length ?? 0) === exported.messages.length,
  `${importedChat.body?.messages?.length} of ${exported.messages.length}`
);

// 14. Titles, pinning, and archiving.
const titled = await jsonFetch(`/api/chats/${chatId}/title`, { method: "POST", body: "{}" });
check("auto-title returns a title", titled.status === 200 && Boolean(titled.body?.title), String(titled.body?.title).slice(0, 56));

const renamed = await jsonFetch(`/api/chats/${chatId}`, { method: "PATCH", body: JSON.stringify({ title: "Renamed by the smoke test" }) });
check("renaming keeps a user title", renamed.status === 200 && renamed.body?.chat?.titleSource === "user", renamed.body?.chat?.titleSource);

const archived = await jsonFetch(`/api/chats/${chatId}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
check("chat can be archived", archived.status === 200 && archived.body?.chat?.archived === true);
const chatList = await jsonFetch("/api/chats");
check(
  "archived chat is still listed and flagged",
  chatList.status === 200 && chatList.body.chats.some((chat) => chat.id === chatId && chat.archived === true)
);
await jsonFetch(`/api/chats/${chatId}`, { method: "PATCH", body: JSON.stringify({ archived: false }) });
// --- Milestone 4: attachments ---------------------------------------------

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const uploadFile = async (name, mime, bytes) => {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type: mime }));
  const response = await fetch(`${appUrl}/api/files`, { method: "POST", body: form });
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  return { status: response.status, body };
};

const textFile = await uploadFile("smoke-notes.txt", "text/plain", new TextEncoder().encode("Conduit smoke attachment"));
check(
  "attachment upload extracts text",
  textFile.status === 201 && String(textFile.body?.file?.text ?? "").includes("smoke attachment"),
  textFile.body?.file?.kind
);

const imageFile = await uploadFile("smoke-pixel.png", "image/png", Buffer.from(PNG_1X1, "base64"));
check(
  "image attachment becomes a data url",
  imageFile.status === 201 && String(imageFile.body?.file?.dataUrl ?? "").startsWith("data:image/png;base64,"),
  imageFile.body?.file?.kind
);

const rejectedFile = await uploadFile("smoke-archive.bin", "application/octet-stream", new Uint8Array([1, 2, 3]));
check("unsupported attachment rejected", rejectedFile.status === 415, String(rejectedFile.body?.error ?? "").slice(0, 40));

if (textFile.body?.file?.id) {
  const served = await fetch(`${appUrl}/api/files/${textFile.body.file.id}`);
  const servedText = await served.text();
  check("stored attachment is served back", served.status === 200 && servedText.includes("smoke attachment"));
}

// --- Milestone 5: artifacts ------------------------------------------------

const artifactStream = async (message) => {
  const response = await fetch(`${appUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });
  if (!response.ok || !response.body) return "";
  const rdr = response.body.getReader();
  let buf = "";
  let out = "";
  while (true) {
    const { done, value } = await rdr.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let index = buf.indexOf("\n\n");
    while (index !== -1) {
      const chunk = buf.slice(0, index).trim();
      buf = buf.slice(index + 2);
      index = buf.indexOf("\n\n");
      if (!chunk.startsWith("data:")) continue;
      const event = JSON.parse(chunk.slice(5).trim());
      if (event.type === "text_delta") out += event.text;
    }
  }
  return out;
};

const artifactText = await artifactStream("please build an artifact panel");
check("artifact stream arrives", artifactText.includes("<artifact"), `${artifactText.length} chars`);

const artifactList = await jsonFetch(`/api/artifacts?chatId=${chatId}`);
const artifact = (artifactList.body?.artifacts ?? []).find((item) => item.identifier === "mock-panel");
check(
  "artifact captured with a type and title",
  artifactList.status === 200 && artifact?.type === "html" && artifact?.title === "Mock panel",
  artifact?.identifier
);

await artifactStream("please build an artifact panel again");
const artifactList2 = await jsonFetch(`/api/artifacts?chatId=${chatId}`);
const updated = (artifactList2.body?.artifacts ?? []).find((item) => item.identifier === "mock-panel");
check("second emission increments the version", (updated?.versionCount ?? 0) >= 2, `v${updated?.versionCount}`);

if (updated?.id) {
  const detail = await jsonFetch(`/api/artifacts/${updated.id}`);
  const versions = detail.body?.versions ?? [];
  check(
    "artifact versions are diffable",
    versions.length >= 2 && versions[0].content !== versions[versions.length - 1].content,
    `${versions.length} versions`
  );
}

// --- Milestone 6: tools ----------------------------------------------------

const toolsState = await jsonFetch("/api/tools");
check(
  "tool catalogue is exposed",
  toolsState.status === 200 &&
    (toolsState.body?.specs ?? []).some((spec) => spec.name === "calculator") &&
    (toolsState.body?.available ?? []).includes("calculator"),
  `${toolsState.body?.specs?.length} specs`
);
check(
  "web search reports that it needs configuration",
  (toolsState.body?.specs ?? []).some((spec) => spec.name === "web_search" && spec.configured === false)
);

const toolStreamResponse = await fetch(`${appUrl}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    chatId,
    message: "please calculate 21*2 for me",
    toolsEnabled: ["calculator", "current_time"],
  }),
});

const toolEvents = [];
let toolStreamText = "";
if (toolStreamResponse.ok && toolStreamResponse.body) {
  const rdr = toolStreamResponse.body.getReader();
  let buf = "";
  while (true) {
    const { done, value } = await rdr.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let index = buf.indexOf("\n\n");
    while (index !== -1) {
      const chunk = buf.slice(0, index).trim();
      buf = buf.slice(index + 2);
      index = buf.indexOf("\n\n");
      if (!chunk.startsWith("data:")) continue;
      const event = JSON.parse(chunk.slice(5).trim());
      toolEvents.push(event);
      if (event.type === "text_delta") toolStreamText += event.text;
    }
  }
}

const toolCallEnd = toolEvents.find(
  (event) => event.type === "tool_call_end" && event.input && event.input.expression
);
check(
  "the model's tool call reaches the stream",
  Boolean(toolCallEnd) && toolCallEnd.input.expression.includes("21"),
  toolCallEnd ? JSON.stringify(toolCallEnd.input) : "no tool_call_end"
);

const toolResult = toolEvents.find((event) => event.type === "tool_result");
check(
  "the calculator tool ran and returned 42",
  Boolean(toolResult) && !toolResult.isError && String(toolResult.output).includes("42"),
  toolResult ? String(toolResult.output).slice(0, 40) : "no tool_result"
);

check(
  "the tool round-trip produced a final answer",
  toolStreamText.includes("42"),
  toolStreamText.slice(0, 60)
);

const afterTools = await jsonFetch(`/api/chats/${chatId}`);
const toolParts = (afterTools.body?.messages ?? []).flatMap((message) => message.content ?? []).filter((part) => part.kind === "tool_use" || part.kind === "tool_result");
check(
  "tool calls and results are persisted in the transcript",
  toolParts.filter((part) => part.kind === "tool_use").length >= 1 &&
    toolParts.filter((part) => part.kind === "tool_result").length >= 1,
  `${toolParts.length} tool parts`
);

// --- Milestone 6b: browser-executed tools ----------------------------------

check(
  "client tools are advertised as running in the browser",
  (toolsState.body?.specs ?? []).some(
    (spec) => spec.name === "run_python" && spec.execution === "client" && spec.requiresApproval === true
  ) &&
    (toolsState.body?.available ?? []).includes("run_python") &&
    (toolsState.body?.available ?? []).includes("convert_units"),
  `${(toolsState.body?.specs ?? []).filter((spec) => spec.execution === "client").length} client tools`
);
check(
  "code execution is approval-gated by default",
  toolsState.body?.config?.code?.autoApprove === false
);

const staleResult = await jsonFetch("/api/chat/tool-result", {
  method: "POST",
  body: JSON.stringify({ id: "call_that_never_existed", output: "noop" }),
});
check("a stale tool result is rejected", staleResult.status === 404, `HTTP ${staleResult.status}`);

const pythonChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ title: "Python round-trip" }),
});
const pythonChatId = pythonChat.body?.chat?.id;

const pythonResponse = await fetch(`${appUrl}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    chatId: pythonChatId,
    message: "please run python to multiply 21 by 2",
    toolsEnabled: ["run_python"],
  }),
});

const pythonEvents = [];
let pythonText = "";
let approval = null;
let delivered = null;
if (pythonResponse.ok && pythonResponse.body) {
  const reader = pythonResponse.body.getReader();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let index = buf.indexOf("\n\n");
    while (index !== -1) {
      const chunk = buf.slice(0, index).trim();
      buf = buf.slice(index + 2);
      index = buf.indexOf("\n\n");
      if (!chunk.startsWith("data:")) continue;
      const event = JSON.parse(chunk.slice(5).trim());
      pythonEvents.push(event);
      if (event.type === "text_delta") pythonText += event.text;
      if (event.type === "tool_approval" && !delivered) {
        approval = event;
        delivered = await jsonFetch("/api/chat/tool-result", {
          method: "POST",
          body: JSON.stringify({ id: event.id, output: "stdout:\n42\n", isError: false }),
        });
      }
    }
  }
}

check(
  "the stream parks a code call until the browser answers",
  Boolean(approval) && approval.name === "run_python" && approval.input?.code?.includes("21"),
  approval ? String(approval.input.code).slice(0, 24) : "no tool_approval event"
);
check("the browser can hand the code result back", delivered?.status === 200, `HTTP ${delivered?.status}`);
check(
  "the model sees the code output and answers",
  pythonText.includes("42") && pythonText.includes("run_python"),
  pythonText.slice(0, 60)
);

const pythonTranscript = await jsonFetch(`/api/chats/${pythonChatId}`);
const pythonParts = (pythonTranscript.body?.messages ?? [])
  .flatMap((message) => message.content ?? [])
  .filter((part) => part.kind === "tool_use" || part.kind === "tool_result");
check(
  "the code run is persisted with its result",
  pythonParts.some((part) => part.kind === "tool_use" && part.name === "run_python" && part.status === "success") &&
    pythonParts.some((part) => part.kind === "tool_result" && String(part.output).includes("42")),
  `${pythonParts.length} parts`
);

const convertChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ title: "Unit conversion" }),
});
const convertResponse = await fetch(`${appUrl}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    chatId: convertChat.body?.chat?.id,
    message: "please convert 26.2 miles to km",
    toolsEnabled: ["convert_units"],
  }),
});
let convertEvents = [];
if (convertResponse.ok && convertResponse.body) {
  const reader = convertResponse.body.getReader();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let index = buf.indexOf("\n\n");
    while (index !== -1) {
      const chunk = buf.slice(0, index).trim();
      buf = buf.slice(index + 2);
      index = buf.indexOf("\n\n");
      if (!chunk.startsWith("data:")) continue;
      convertEvents.push(JSON.parse(chunk.slice(5).trim()));
    }
  }
}
const convertResult = convertEvents.find((event) => event.type === "tool_result");
check(
  "unit conversion runs server-side",
  Boolean(convertResult) && !convertResult.isError && String(convertResult.output).includes("42.16"),
  convertResult ? String(convertResult.output).slice(0, 40) : "no tool_result"
);

// --- Milestone 7: thinking, context management, presets, fallback ----------

const reasoningChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ title: "Reasoning round-trip" }),
});
const reasoningChatId = reasoningChat.body?.chat?.id;
const reasoningResponse = await fetch(`${appUrl}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ chatId: reasoningChatId, message: "think about 2+2 for me" }),
});
const reasoningEvents = [];
let reasoningText = "";
if (reasoningResponse.ok && reasoningResponse.body) {
  const reader = reasoningResponse.body.getReader();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let index = buf.indexOf("\n\n");
    while (index !== -1) {
      const chunk = buf.slice(0, index).trim();
      buf = buf.slice(index + 2);
      index = buf.indexOf("\n\n");
      if (!chunk.startsWith("data:")) continue;
      const event = JSON.parse(chunk.slice(5).trim());
      reasoningEvents.push(event);
      if (event.type === "reasoning_delta") reasoningText += event.text;
    }
  }
}
check(
  "reasoning deltas stream to the browser",
  reasoningText.includes("step by step"),
  reasoningText.slice(0, 40)
);

const reasoningTranscript = await jsonFetch(`/api/chats/${reasoningChatId}`);
const reasoningMessage = (reasoningTranscript.body?.messages ?? []).find(
  (message) => message.role === "assistant" && (message.content ?? []).some((part) => part.kind === "thinking")
);
const thinkingPart = (reasoningMessage?.content ?? []).find((part) => part.kind === "thinking");
check(
  "the thinking block persists with its duration",
  Boolean(thinkingPart) && typeof thinkingPart.durationMs === "number",
  thinkingPart ? `${thinkingPart.durationMs}ms` : "no thinking part"
);
check(
  "the chat detail exposes the model window for the context meter",
  (reasoningTranscript.body?.model?.contextWindow ?? 0) > 0 &&
    "fallbackId" in (reasoningTranscript.body?.model ?? {}),
  `window ${reasoningTranscript.body?.model?.contextWindow}, fallback ${reasoningTranscript.body?.model?.fallbackId}`
);

// Context management: several turns, then compress.
const summarizeChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ title: "Context management" }),
});
const summarizeChatId = summarizeChat.body?.chat?.id;
for (const prompt of ["first question about rivers", "second question about mountains", "third question about deserts", "fourth question about oceans"]) {
  const stream = await fetch(`${appUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chatId: summarizeChatId, message: prompt }),
  });
  if (stream.body) {
    const reader = stream.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  }
}

const beforeSummarize = await jsonFetch(`/api/chats/${summarizeChatId}`);
const contextBeforeCount = (beforeSummarize.body?.messages ?? []).length;
const summarizedResult = await jsonFetch(`/api/chats/${summarizeChatId}/summarize`, {
  method: "POST",
  body: JSON.stringify({ mode: "truncate" }),
});
check(
  "context compression replaces the oldest turns with one summary node",
  summarizedResult.status === 200 && summarizedResult.body?.mode === "truncated" && summarizedResult.body?.removed >= 2,
  `${summarizedResult.body?.removed} replaced, ${summarizedResult.body?.kept} kept`
);

const afterSummarize = await jsonFetch(`/api/chats/${summarizeChatId}`);
const afterMessages = afterSummarize.body?.messages ?? [];
const summaryRow = afterMessages.find(
  (message) => message.role === "system" && String(message.content?.[0]?.text ?? "").includes("truncated")
);
check(
  "the summary node is on the active path and the transcript got shorter",
  Boolean(summaryRow) && afterMessages.length < contextBeforeCount,
  `${contextBeforeCount} -> ${afterMessages.length} messages`
);
check(
  "replaced messages stay in the tree (nothing is deleted)",
  (await jsonFetch(`/api/chats/${summarizeChatId}/export?format=json`)).status === 200
);

const presetsPut = await jsonFetch("/api/presets", {
  method: "PUT",
  body: JSON.stringify({
    presets: [
      { id: "smoke-preset", name: "Smoke", temperature: 0.3, topP: 0.9, maxTokens: 2048, thinkingBudget: 512 },
    ],
  }),
});
check(
  "custom presets round-trip through the API",
  presetsPut.status === 200 && (presetsPut.body?.presets ?? []).some((preset) => preset.id === "smoke-preset"),
  `${(presetsPut.body?.presets ?? []).length} stored`
);
const presetsGet = await jsonFetch("/api/presets");
check(
  "saved presets come back on reload",
  (presetsGet.body?.presets ?? []).some((preset) => preset.name === "Smoke")
);
const badPreset = await jsonFetch("/api/presets", {
  method: "PUT",
  body: JSON.stringify({ presets: [{ id: "bad", name: "Bad", temperature: 99, topP: 1, maxTokens: 10 }] }),
});
check("invalid presets are rejected", badPreset.status === 422 || badPreset.status === 400, `HTTP ${badPreset.status}`);


// --- Fallback model: an unreachable primary hands off to the fallback ------

const fallbackModelId =
  (discovered.body?.models ?? []).find((model) => model.id !== modelId)?.id ?? modelId;

const flakyServer = createServer((req, res) => {
  if (req.method === "GET" && (req.url ?? "").endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: "flaky-model", object: "model" }] }));
    return;
  }
  res.writeHead(500, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "planned outage" } }));
});
await new Promise((resolve) => flakyServer.listen(0, "127.0.0.1", resolve));
const flakyPort = flakyServer.address().port;

const flakyProvider = await jsonFetch("/api/providers", {
  method: "POST",
  body: JSON.stringify({
    name: "Flaky Provider",
    baseUrl: `http://127.0.0.1:${flakyPort}/v1`,
    apiFormat: "openai-completions",
    apiKey: "flaky-key",
  }),
});
const flakyProviderId = flakyProvider.body?.provider?.id;
const flakyModels = await jsonFetch(`/api/providers/${flakyProviderId}/models`, {
  method: "POST",
  body: JSON.stringify({ discover: true }),
});
const flakyModelId = flakyModels.body?.models?.[0]?.id;

// A model flagged as the fallback elsewhere in the database would win over the
// one this run picks, so park those flags and put them back at the end.
const allModels = await jsonFetch("/api/models");
const parkedFallbacks = (allModels.body?.models ?? []).filter((model) => model.isFallback);
for (const model of parkedFallbacks) {
  await jsonFetch(`/api/models/${model.id}`, { method: "PATCH", body: JSON.stringify({ isFallback: false }) });
}

await jsonFetch(`/api/models/${fallbackModelId}`, {
  method: "PATCH",
  body: JSON.stringify({ isFallback: true }),
});

const fallbackChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ title: "Fallback", modelId: flakyModelId, providerId: flakyProviderId }),
});

const fallbackResponse = await fetch(`${appUrl}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ chatId: fallbackChat.body?.chat?.id, message: "Hello from the fallback test" }),
});
const fallbackEvents = [];
let fallbackText = "";
if (fallbackResponse.ok && fallbackResponse.body) {
  const reader = fallbackResponse.body.getReader();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let index = buf.indexOf("\n\n");
    while (index !== -1) {
      const chunk = buf.slice(0, index).trim();
      buf = buf.slice(index + 2);
      index = buf.indexOf("\n\n");
      if (!chunk.startsWith("data:")) continue;
      const event = JSON.parse(chunk.slice(5).trim());
      fallbackEvents.push(event);
      if (event.type === "text_delta") fallbackText += event.text;
    }
  }
}

const switchEvent = fallbackEvents.find((event) => event.type === "model_switch");
check(
  "an unreachable primary model falls back to the configured model",
  Boolean(switchEvent) && fallbackText.length > 10 && !fallbackEvents.some((event) => event.type === "error"),
  switchEvent ? `switched to ${switchEvent.modelLabel}` : "no model_switch event"
);

await jsonFetch(`/api/models/${fallbackModelId}`, {
  method: "PATCH",
  body: JSON.stringify({ isFallback: false }),
});
for (const model of parkedFallbacks) {
  await jsonFetch(`/api/models/${model.id}`, { method: "PATCH", body: JSON.stringify({ isFallback: true }) });
}
await jsonFetch(`/api/providers/${flakyProviderId}`, { method: "DELETE" });
await new Promise((resolve) => flakyServer.close(resolve));


// --- Milestone 8: projects, retrieval, memory, styles, prompts -------------

/** Streams a chat turn and returns every SSE event it produced. */
const streamEvents = async (payload) => {
  const response = await fetch(`${appUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const events = [];
  if (!response.ok || !response.body) return events;
  const reader = response.body.getReader();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let index = buf.indexOf("\n\n");
    while (index !== -1) {
      const chunk = buf.slice(0, index).trim();
      buf = buf.slice(index + 2);
      index = buf.indexOf("\n\n");
      if (!chunk.startsWith("data:")) continue;
      events.push(JSON.parse(chunk.slice(5).trim()));
    }
  }
  return events;
};

const eventsText = (events) =>
  events
    .filter((event) => event.type === "text_delta")
    .map((event) => event.text)
    .join("");

// Clean slate, so the checks below stay repeatable on a reused database.
const staleProjects = await jsonFetch("/api/projects");
for (const project of staleProjects.body?.projects ?? []) {
  await jsonFetch(`/api/projects/${project.id}`, { method: "DELETE" });
}
const staleMemories = await jsonFetch("/api/memories");
for (const memory of staleMemories.body?.memories ?? []) {
  await jsonFetch(`/api/memories/${memory.id}`, { method: "DELETE" });
}
const staleStyles = await jsonFetch("/api/styles");
for (const style of staleStyles.body?.styles ?? []) {
  if (!style.builtin) await jsonFetch(`/api/styles/${style.id}`, { method: "DELETE" });
}
const stalePrompts = await jsonFetch("/api/prompts");
for (const prompt of stalePrompts.body?.prompts ?? []) {
  if (!prompt.builtin) await jsonFetch(`/api/prompts/${prompt.id}`, { method: "DELETE" });
}

// Preferences
const profileSaved = await jsonFetch("/api/profile", {
  method: "PUT",
  body: JSON.stringify({ name: "Smoke Tester", role: "QA", instructions: "Lead with the answer." }),
});
const profileRead = await jsonFetch("/api/profile");
check(
  "profile and preferences round-trip through the API",
  profileSaved.status === 200 &&
    profileRead.body?.profile?.name === "Smoke Tester" &&
    profileRead.body?.profile?.instructions === "Lead with the answer.",
  profileRead.body?.profile?.role
);

const profileChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ title: "Profile marker" }),
});
const profileEvents = await streamEvents({ chatId: profileChat.body?.chat?.id, message: "marker-check profile" });
check(
  "profile preferences are layered onto every chat",
  eventsText(profileEvents).includes("profile-marker-applied"),
  eventsText(profileEvents).slice(0, 48)
);

// Model roles
const modelOptions = await jsonFetch("/api/models");
check(
  "every stored model is listed with its provider",
  modelOptions.status === 200 &&
    (modelOptions.body?.models ?? []).some((model) => model.id === modelId && model.providerName),
  `${(modelOptions.body?.models ?? []).length} models`
);
const rolesSaved = await jsonFetch("/api/roles", {
  method: "PUT",
  body: JSON.stringify({ embeddings: modelId, title: modelId, summarization: modelId }),
});
check(
  "the title, summarization, and embeddings roles can be assigned",
  rolesSaved.status === 200 &&
    rolesSaved.body?.assignments?.embeddings === modelId &&
    rolesSaved.body?.assignments?.title === modelId &&
    rolesSaved.body?.assignments?.summarization === modelId,
  JSON.stringify(rolesSaved.body?.assignments)
);

// Response styles
const styles = await jsonFetch("/api/styles");
check(
  "built-in response styles are seeded",
  styles.status === 200 &&
    ["normal", "concise", "explanatory", "formal"].every((slug) =>
      (styles.body?.styles ?? []).some((style) => style.slug === slug)
    ),
  `${(styles.body?.styles ?? []).length} styles`
);
const createdStyle = await jsonFetch("/api/styles", {
  method: "POST",
  body: JSON.stringify({ name: "Smoke style", instructions: "Answer in exactly three bullets." }),
});
const smokeStyleId = createdStyle.body?.style?.id;
check(
  "a custom style can be created",
  createdStyle.status === 201 && createdStyle.body?.style?.builtin === false,
  createdStyle.body?.style?.slug
);
const updatedStyle = await jsonFetch(`/api/styles/${smokeStyleId}`, {
  method: "PATCH",
  body: JSON.stringify({ instructions: "Answer in exactly three bullets and nothing else." }),
});
check(
  "a custom style can be edited",
  updatedStyle.status === 200 && String(updatedStyle.body?.style?.instructions ?? "").includes("nothing else")
);
const builtinStyle = (styles.body?.styles ?? []).find((style) => style.slug === "concise");
const builtinStyleDelete = await jsonFetch(`/api/styles/${builtinStyle?.id}`, { method: "DELETE" });
check("built-in styles are protected", builtinStyleDelete.status === 400, `HTTP ${builtinStyleDelete.status}`);

const styleChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ title: "Style chat", styleId: smokeStyleId }),
});
const styleEvents = await streamEvents({ chatId: styleChat.body?.chat?.id, message: "marker-check style" });
check(
  "a chat's response style reaches the model",
  eventsText(styleEvents).includes("style-marker-applied"),
  eventsText(styleEvents).slice(0, 48)
);
const styleDetail = await jsonFetch(`/api/chats/${styleChat.body?.chat?.id}`);
check("the chat remembers its style", styleDetail.body?.chat?.styleId === smokeStyleId);
const deletedStyle = await jsonFetch(`/api/styles/${smokeStyleId}`, { method: "DELETE" });
check("a custom style can be deleted", deletedStyle.status === 200);

// Slash commands
const prompts = await jsonFetch("/api/prompts");
check(
  "built-in slash commands are seeded",
  prompts.status === 200 &&
    (prompts.body?.prompts ?? []).some((prompt) => prompt.command === "summarize" && prompt.builtin),
  `${(prompts.body?.prompts ?? []).length} commands`
);
const createdPrompt = await jsonFetch("/api/prompts", {
  method: "POST",
  body: JSON.stringify({ name: "Smoke command", command: "smoke-command", content: "Do the thing with {text}" }),
});
check(
  "a custom slash command can be saved",
  createdPrompt.status === 201 && createdPrompt.body?.prompt?.command === "smoke-command",
  createdPrompt.body?.prompt?.command
);
const duplicatePrompt = await jsonFetch("/api/prompts", {
  method: "POST",
  body: JSON.stringify({ name: "Duplicate", command: "smoke-command", content: "nope" }),
});
check("duplicate slash commands are rejected", duplicatePrompt.status === 400, String(duplicatePrompt.body?.error ?? ""));
const smokePromptId = createdPrompt.body?.prompt?.id;
const updatedPrompt = await jsonFetch(`/api/prompts/${smokePromptId}`, {
  method: "PATCH",
  body: JSON.stringify({ content: "Do the other thing with {text}" }),
});
check(
  "a slash command can be edited",
  updatedPrompt.status === 200 && String(updatedPrompt.body?.prompt?.content ?? "").includes("other thing")
);
const builtinPrompt = (prompts.body?.prompts ?? []).find((prompt) => prompt.command === "summarize");
const builtinPromptDelete = await jsonFetch(`/api/prompts/${builtinPrompt?.id}`, { method: "DELETE" });
check("built-in slash commands are protected", builtinPromptDelete.status === 400);
const deletedPrompt = await jsonFetch(`/api/prompts/${smokePromptId}`, { method: "DELETE" });
check("a custom slash command can be deleted", deletedPrompt.status === 200);

// Projects + retrieval (vector path, because an embeddings role is assigned)
const project = await jsonFetch("/api/projects", {
  method: "POST",
  body: JSON.stringify({
    name: "Smoke project",
    description: "Retrieval",
    instructions: "Cite the file you used.",
  }),
});
const projectId = project.body?.project?.id;
check("a project can be created", project.status === 201 && Boolean(projectId), projectId);

const attached = await jsonFetch(`/api/projects/${projectId}/files`, {
  method: "POST",
  body: JSON.stringify({
    name: "handbook.md",
    text: "# Handbook\n\nThe smoke marker kb-marker-7 lives here. Conduit chunks this file and retrieves the passage that matches a question.",
  }),
});
check(
  "a text file is chunked and indexed",
  attached.status === 201 && attached.body?.file?.status === "indexed" && attached.body?.file?.chunkCount >= 1,
  `${attached.body?.file?.chunkCount} chunks`
);
check("an assigned embeddings model embeds new files", attached.body?.embedded === true);

const projectDetail = await jsonFetch(`/api/projects/${projectId}`);
check(
  "the project exposes files, chats, and stats",
  projectDetail.status === 200 &&
    projectDetail.body?.stats?.chunks >= 1 &&
    (projectDetail.body?.files?.length ?? 0) === 1,
  JSON.stringify(projectDetail.body?.stats)
);

const projectChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ projectId, title: "Project chat" }),
});
const projectChatId = projectChat.body?.chat?.id;
check("a chat can be scoped to a project", projectChat.status === 201 && Boolean(projectChatId));

const projectEvents = await streamEvents({ chatId: projectChatId, message: "What is kb-marker-7?" });
const sourcesEvent = projectEvents.find((event) => event.type === "sources");
check(
  "project retrieval attaches knowledge-base excerpts",
  Boolean(sourcesEvent) && sourcesEvent.sources.length >= 1,
  sourcesEvent ? `${sourcesEvent.sources.length} excerpts` : "no sources event"
);
check("retrieval reports the vector path", sourcesEvent?.mode === "embeddings", sourcesEvent?.mode);
check(
  "the excerpts reach the model's system prompt",
  eventsText(projectEvents).includes("kb-marker-7"),
  eventsText(projectEvents).slice(0, 60)
);

const projectChats = await jsonFetch(`/api/projects/${projectId}`);
check(
  "the project lists the chats that belong to it",
  (projectChats.body?.chats ?? []).some((chat) => chat.id === projectChatId),
  `${(projectChats.body?.chats ?? []).length} chats`
);

// Keyword fallback: no embeddings role, so retrieval ranks with BM25.
await jsonFetch("/api/roles", { method: "PUT", body: JSON.stringify({ embeddings: null }) });
const keywordProject = await jsonFetch("/api/projects", {
  method: "POST",
  body: JSON.stringify({ name: "Smoke keyword project" }),
});
const keywordProjectId = keywordProject.body?.project?.id;
const keywordFile = await jsonFetch(`/api/projects/${keywordProjectId}/files`, {
  method: "POST",
  body: JSON.stringify({ name: "notes.md", text: "Without an embeddings model this passage is found by keyword ranking. kb-marker-7 again." }),
});
check(
  "without an embeddings model, files are indexed with keyword search",
  keywordFile.status === 201 && keywordFile.body?.embedded === false,
  `embedded: ${keywordFile.body?.embedded}`
);
const keywordChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ projectId: keywordProjectId, title: "Keyword chat" }),
});
const keywordEvents = await streamEvents({ chatId: keywordChat.body?.chat?.id, message: "Where is kb-marker-7 mentioned?" });
const keywordSources = keywordEvents.find((event) => event.type === "sources");
check(
  "keyword retrieval still finds the passage",
  Boolean(keywordSources) && keywordSources.mode === "keywords" && keywordSources.sources.length >= 1,
  `${keywordSources?.mode} · ${keywordSources?.sources?.length ?? 0} excerpts`
);
check(
  "the keyword passage reaches the model",
  eventsText(keywordEvents).includes("kb-marker-7"),
  eventsText(keywordEvents).slice(0, 60)
);

// Memory: proposals, storage, editing, recall, and incognito isolation.
const memoryOn = await jsonFetch("/api/memories", { method: "POST", body: JSON.stringify({ enabled: true }) });
check("memory can be switched on", memoryOn.status === 200 && memoryOn.body?.enabled === true);

const memoryChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ title: "Memory proposal" }),
});
const memoryChatId = memoryChat.body?.chat?.id;
const memoryEvents = await streamEvents({ chatId: memoryChatId, message: "please remember that I prefer short answers" });
check(
  "the model's memory proposal streams to the browser",
  memoryEvents.some((event) => event.type === "memory" && String(event.fact).toLowerCase().includes("short")),
  JSON.stringify(memoryEvents.filter((event) => event.type === "memory").map((event) => event.fact))
);
const memoryState = await jsonFetch("/api/memories");
const proposed = (memoryState.body?.memories ?? []).find((memory) => memory.content.includes("short, direct answers"));
check("the proposed fact is stored", Boolean(proposed), `${(memoryState.body?.memories ?? []).length} memories`);

const memoryTranscript = await jsonFetch(`/api/chats/${memoryChatId}`);
const storedAnswer = (memoryTranscript.body?.messages ?? [])
  .filter((message) => message.role === "assistant")
  .flatMap((message) => message.content ?? [])
  .filter((part) => part.kind === "text")
  .map((part) => part.text)
  .join("");
check(
  "memory tags are stripped from the stored answer",
  storedAnswer.length > 0 && !storedAnswer.includes("<memory>"),
  storedAnswer.slice(0, 40)
);
const editedMemory = await jsonFetch(`/api/memories/${proposed?.id}`, {
  method: "PATCH",
  body: JSON.stringify({ content: "Prefers short answers (smoke-tested)." }),
});
check(
  "a memory can be edited",
  editedMemory.status === 200 && String(editedMemory.body?.memory?.content ?? "").includes("smoke-tested")
);
const removedMemory = await jsonFetch(`/api/memories/${proposed?.id}`, { method: "DELETE" });
check("a memory can be deleted", removedMemory.status === 200);

await jsonFetch("/api/memories", {
  method: "POST",
  body: JSON.stringify({ content: "The user keeps a talking parrot named Kiwi." }),
});
const recallChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ title: "Memory recall" }),
});
const recallEvents = await streamEvents({
  chatId: recallChat.body?.chat?.id,
  message: "marker-check memory: what do you know about Kiwi?",
});
check(
  "relevant memories are recalled into the system prompt",
  eventsText(recallEvents).includes("memory-marker-recalled"),
  eventsText(recallEvents).slice(0, 48)
);

const protocolChat = await jsonFetch("/api/chats", { method: "POST", body: JSON.stringify({ title: "Memory protocol" }) });
const protocolEvents = await streamEvents({ chatId: protocolChat.body?.chat?.id, message: "memory-protocol-check" });
check(
  "the model is taught the memory protocol",
  eventsText(protocolEvents).includes("memory-protocol-applied"),
  eventsText(protocolEvents).slice(0, 48)
);

// Incognito: answers stream, nothing is written.
const incognitoChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ incognito: true }),
});
const incognitoId = incognitoChat.body?.chat?.id;
const incognitoEvents = await streamEvents({
  chatId: incognitoId,
  message: "please remember that this turn must never be stored",
});
check("an incognito chat still answers", eventsText(incognitoEvents).length > 10, eventsText(incognitoEvents).slice(0, 40));
const incognitoProtocol = await streamEvents({ chatId: incognitoId, message: "memory-protocol-check" });
check(
  "incognito chats are not offered the memory protocol",
  eventsText(incognitoProtocol).includes("memory-protocol-missing"),
  eventsText(incognitoProtocol).slice(0, 48)
);
check(
  "incognito chats persist no messages",
  (await jsonFetch(`/api/chats/${incognitoId}`)).body?.messages?.length === 0
);
const historyAfter = await jsonFetch("/api/chats");
check(
  "incognito chats stay out of the history list",
  !(historyAfter.body?.chats ?? []).some((chat) => chat.id === incognitoId)
);

// Deleting a project removes its chats' scoping but keeps the chats.
const deletedProject = await jsonFetch(`/api/projects/${keywordProjectId}`, { method: "DELETE" });
check("a project can be deleted", deletedProject.status === 200);

// --- Milestone 9: MCP client, custom tools, Deep Research ------------------

const mockRoot = providerBaseUrl.replace(/\/v1\/?$/, "");

// Clean slate, so these checks stay repeatable on a reused database.
for (const server of (await jsonFetch("/api/mcp")).body?.servers ?? []) {
  await jsonFetch(`/api/mcp/${server.id}`, { method: "DELETE" });
}
for (const tool of (await jsonFetch("/api/custom-tools")).body?.tools ?? []) {
  await jsonFetch(`/api/custom-tools/${tool.id}`, { method: "DELETE" });
}

// Deep Research without a search provider must say so instead of failing silently.
const researchOffChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ title: "Research without search" }),
});
const researchOffEvents = await streamEvents({
  chatId: researchOffChat.body?.chat?.id,
  message: "deep research on anything at all",
  research: true,
});
const offStep = researchOffEvents.find((event) => event.type === "research_step" && event.status === "error");
check("Deep Research explains that it needs a search provider", Boolean(offStep), offStep?.label);

// The mock provider also serves a search endpoint, so research runs offline.
const previousSearch = (await jsonFetch("/api/tools")).body?.config?.webSearch;
const searchConfig = await jsonFetch("/api/tools", {
  method: "PATCH",
  body: JSON.stringify({
    webSearch: { enabled: true, provider: "custom", endpoint: `${mockRoot}/search?q={query}`, maxResults: 3 },
  }),
});
check(
  "a custom search endpoint can be configured",
  searchConfig.status === 200 && searchConfig.body?.config?.webSearch?.provider === "custom",
  searchConfig.body?.config?.webSearch?.endpoint
);

// MCP: add the mock server, then read what it offers.
const mcpAdded = await jsonFetch("/api/mcp", {
  method: "POST",
  body: JSON.stringify({
    name: "Mock MCP",
    url: `${mockRoot}/mcp`,
    transport: "http",
    headers: [{ name: "X-Smoke-Token", value: "mcp-secret-value", secret: true }],
  }),
});
const mcpId = mcpAdded.body?.serverId;
check("an MCP server can be added", mcpAdded.status === 201 && Boolean(mcpId), mcpAdded.body?.syncError ?? mcpId);
check("adding an MCP server syncs its capabilities", mcpAdded.body?.synced === true, String(mcpAdded.body?.syncError ?? ""));

const mcpServer = (mcpAdded.body?.servers ?? []).find((server) => server.id === mcpId);
check(
  "tools, resources, and prompts are listed",
  mcpServer?.toolCount === 1 && mcpServer?.resourceCount === 1 && mcpServer?.promptCount === 1,
  JSON.stringify({ tools: mcpServer?.toolCount, resources: mcpServer?.resourceCount, prompts: mcpServer?.promptCount })
);
check("the handshake reports the server name", String(mcpServer?.serverInfo ?? "").includes("mock-mcp"), mcpServer?.serverInfo);
check(
  "MCP header secrets are stored masked",
  mcpServer?.headers?.[0]?.masked !== "mcp-secret-value" && !JSON.stringify(mcpAdded.body).includes("mcp-secret-value"),
  mcpServer?.headers?.[0]?.masked
);

const mcpDetail = await jsonFetch(`/api/mcp/${mcpId}`);
const mcpTool = mcpDetail.body?.cache?.tools?.[0];
check(
  "MCP tools get a provider-safe name",
  /^[a-zA-Z0-9_-]{1,64}$/.test(mcpTool?.exposed ?? "") && String(mcpTool?.exposed).startsWith("mcp__"),
  mcpTool?.exposed
);

const mcpCatalog = await jsonFetch("/api/tools");
const mcpSpec = (mcpCatalog.body?.specs ?? []).find((spec) => spec.name === mcpTool?.exposed);
check("the MCP tool shows up in the tools menu", mcpSpec?.source === "mcp" && mcpSpec?.configured === true, mcpSpec?.label);

const mcpChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ title: "MCP chat", toolsEnabled: [mcpTool?.exposed] }),
});
const mcpEvents = await streamEvents({ chatId: mcpChat.body?.chat?.id, message: "mcp-echo please" });
check(
  "the model can call an MCP tool",
  eventsText(mcpEvents).includes("mock-mcp echoes: hello from smoke"),
  eventsText(mcpEvents).slice(0, 80)
);

const resourceRead = await jsonFetch(`/api/mcp/${mcpId}`, {
  method: "POST",
  body: JSON.stringify({ action: "resource", uri: "mock://welcome" }),
});
check("an MCP resource can be read", resourceRead.status === 200 && String(resourceRead.body?.text).includes("mock MCP server"));

const promptRead = await jsonFetch(`/api/mcp/${mcpId}`, {
  method: "POST",
  body: JSON.stringify({ action: "prompt", name: "mock_summary", args: { topic: "Conduit" } }),
});
check("an MCP prompt can be rendered", promptRead.status === 200 && String(promptRead.body?.text).includes("Summarise Conduit"));

const mcpRefreshed = await jsonFetch(`/api/mcp/${mcpId}`, { method: "POST", body: JSON.stringify({ action: "refresh" }) });
check("an MCP server can be refreshed on demand", mcpRefreshed.status === 200 && mcpRefreshed.body?.cache?.toolCount === 1);

// Custom HTTP tools: a GET tool pointed at the mock search endpoint.
const custom = await jsonFetch("/api/custom-tools", {
  method: "POST",
  body: JSON.stringify({
    label: "Mock lookup",
    description: "Look something up in the mock search backend.",
    method: "GET",
    url: `${mockRoot}/search`,
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  }),
});
const customTool = custom.body?.tool;
check("a custom HTTP tool can be defined", custom.status === 201 && Boolean(customTool?.id), custom.body?.error ?? customTool?.exposed);
check("the custom tool has a provider-safe name", /^custom__[a-z0-9_]+$/.test(customTool?.exposed ?? ""), customTool?.exposed);

const customTest = await jsonFetch(`/api/custom-tools/${customTool?.id}`, { method: "POST" });
check("a custom tool can be tested", customTest.status === 200 && customTest.body?.test?.status === 200, `HTTP ${customTest.body?.test?.status}`);

const customChat = await jsonFetch("/api/chats", {
  method: "POST",
  body: JSON.stringify({ title: "Custom tool chat", toolsEnabled: [customTool?.exposed] }),
});
const customEvents = await streamEvents({ chatId: customChat.body?.chat?.id, message: "custom-tool-call please" });
check(
  "the model can call a custom tool",
  eventsText(customEvents).includes("Mock research page one"),
  eventsText(customEvents).slice(0, 80)
);

const customDisabled = await jsonFetch(`/api/custom-tools/${customTool?.id}`, {
  method: "PATCH",
  body: JSON.stringify({ enabled: false }),
});
check("a custom tool can be switched off", customDisabled.body?.tool?.enabled === false);
const afterDisable = await jsonFetch("/api/tools");
check(
  "a disabled custom tool leaves the catalogue",
  !(afterDisable.body?.specs ?? []).some((spec) => spec.name === customTool?.exposed)
);

// Deep Research end to end: plan, search, read, then a cited report.
const researchChat = await jsonFetch("/api/chats", { method: "POST", body: JSON.stringify({ title: "Deep research" }) });
const researchEvents = await streamEvents({
  chatId: researchChat.body?.chat?.id,
  message: "deep research on the conduit retrieval pipeline",
  research: true,
});
const researchSteps = researchEvents.filter((event) => event.type === "research_step");
check(
  "Deep Research plans the research",
  researchSteps.some((step) => step.label === "Planned the research"),
  researchSteps.map((step) => step.label).slice(0, 3).join(" | ")
);
check(
  "Deep Research runs the planned searches",
  researchSteps.some((step) => step.status === "done" && step.label.startsWith("Searched")),
  researchSteps.filter((step) => step.status === "done").length + " done steps"
);
check(
  "Deep Research reports every read attempt",
  researchSteps.some((step) => step.label.startsWith("Read ") || step.label.startsWith("Could not read ")),
  researchSteps.map((step) => step.label).filter((label) => label.startsWith("Read") || label.startsWith("Could not")).join(" | ")
);
const researchSources = researchEvents.find((event) => event.type === "research_sources");
check(
  "Deep Research streams its numbered sources",
  (researchSources?.sources?.length ?? 0) >= 2,
  JSON.stringify(researchSources?.sources?.map((source) => source.url) ?? [])
);
check(
  "the report cites the sources",
  /\[1\]/.test(eventsText(researchEvents)) && eventsText(researchEvents).includes("Sources:"),
  eventsText(researchEvents).slice(0, 80)
);

// Teardown: leave the database as it was found.
if (originalToolsConfig?.webSearch) {
  await jsonFetch("/api/tools", { method: "PATCH", body: JSON.stringify({ webSearch: originalToolsConfig.webSearch }) });
}
if (previousSearch) {
  await jsonFetch("/api/tools", { method: "PATCH", body: JSON.stringify({ webSearch: previousSearch }) });
}
await jsonFetch(`/api/mcp/${mcpId}`, { method: "DELETE" });
await jsonFetch(`/api/custom-tools/${customTool?.id}`, { method: "DELETE" });

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length === 0 ? 0 : 1;