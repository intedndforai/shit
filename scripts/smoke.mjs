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
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);