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

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length === 0 ? 0 : 1;