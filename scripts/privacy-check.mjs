/**
 * Privacy-layer checks (Privacy spec sections 3.2-3.6).
 *
 * Requires the app (`npm run dev`) and the mock provider
 * (`node scripts/mock-provider.mjs`) to be running.
 *
 *   node scripts/privacy-check.mjs [appUrl] [providerBaseUrl]
 *
 * Against `next dev` the very first request compiles the app shell, which can take
 * a minute on a slow disk; every request here is bounded so a stall is reported.
 *
 * WARNING: this mutates the database the app is pointed at. It adds two providers
 * and a few chats, then runs the destructive "delete all my data" action, which
 * wipes every chat, message, artifact, memory, project and egress row and resets
 * the stored privacy/tool settings (provider rows are kept). Point SQLITE_PATH at
 * a scratch file if you would rather leave the dev database alone.
 */


/** Every request is bounded so a stalled server fails the check instead of hanging. */
const REQUEST_TIMEOUT_MS = 120_000;

const appUrl = process.argv[2] ?? "http://localhost:3000";
const providerBaseUrl = process.argv[3] ?? "http://127.0.0.1:4123/v1";

const CANARY_EMAIL = "canary-7f3a@example.com";
const CANARY_TERM = "Project-Orion";
const CANARY_PASSWORD = "hunter2secret";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function jsonFetch(path, init) {
  const response = await fetch(`${appUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

/**
 * Streams a chat turn. Returns the concatenated text, the redaction summary the
 * server reported, and — for blocked sends — the parsed error envelope so the
 * caller can assert on `code`.
 */
async function streamChat(payload) {
  const response = await fetch(`${appUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok || !response.body) {
    const raw = await response.text();
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    return {
      ok: false,
      status: response.status,
      message: body?.error ?? `status ${response.status}`,
      code: body?.code ?? null,
      body,
      text: "",
      chatId: payload.chatId ?? null,
      redactions: null,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let chatId = payload.chatId ?? null;
  let redactions = null;

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
      let event = null;
      try {
        event = JSON.parse(chunk.slice(5).trim());
      } catch {
        continue;
      }
      if (event.type === "chat") chatId = event.chatId;
      if (event.type === "text_delta") text += event.text;
      if (event.type === "redactions") redactions = event.summary;
    }
  }
  return { ok: true, status: response.status, chatId, text, redactions, code: null, body: null };
}

function messageText(content) {
  return (content ?? [])
    .map((part) => (part.kind === "text" ? part.text ?? "" : ""))
    .join("");
}

async function main() {
  const health = await jsonFetch("/api/health");
  check("health endpoint responds", health.status === 200, `database reachable: ${health.body?.database?.reachable}`);

  /* --- Section 3.2: transport hardening ---------------------------------- */

  const shell = await fetch(`${appUrl}/`);
  check(
    "app shell sends a strict referrer policy",
    (shell.headers.get("referrer-policy") ?? "").toLowerCase() === "no-referrer",
    shell.headers.get("referrer-policy") ?? "(none)"
  );
  check(
    "app shell sends nosniff and frame protections",
    (shell.headers.get("x-content-type-options") ?? "") === "nosniff" &&
      (shell.headers.get("x-frame-options") ?? "").length > 0,
    `${shell.headers.get("x-content-type-options")} / ${shell.headers.get("x-frame-options")}`
  );
  check(
    "app shell sends a content security policy",
    (shell.headers.get("content-security-policy") ?? "").includes("default-src 'self'"),
    (shell.headers.get("content-security-policy") ?? "(none)").slice(0, 40)
  );
  const apiResponse = await fetch(`${appUrl}/api/privacy`);
  check(
    "API responses are never cached",
    (apiResponse.headers.get("cache-control") ?? "").includes("no-store"),
    apiResponse.headers.get("cache-control") ?? "(none)"
  );

  /* --- Provider + model setup (mock) ------------------------------------- */

  const createdProvider = await jsonFetch("/api/providers", {
    method: "POST",
    body: JSON.stringify({
      name: "Mock Privacy",
      baseUrl: providerBaseUrl,
      apiFormat: "openai-completions",
      apiKey: "test-key",
    }),
  });
  const providerId = createdProvider.body?.provider?.id;
  check("mock provider created", createdProvider.status === 201 && Boolean(providerId), providerId ?? createdProvider.body?.error);

  const discovered = await jsonFetch(`/api/providers/${providerId}/models`, {
    method: "POST",
    body: JSON.stringify({ discover: true }),
  });
  const modelId = discovered.body?.models?.[0]?.id;
  check("models discovered", Boolean(modelId), `${discovered.body?.models?.length ?? 0} models`);

  const patchedModel = await jsonFetch(`/api/models/${modelId}`, {
    method: "PATCH",
    body: JSON.stringify({ isDefault: true, capabilities: { toolCalling: true, vision: false } }),
  });
  check("default model set", patchedModel.status === 200 && patchedModel.body?.model?.isDefault === true);

  const remoteProvider = await jsonFetch("/api/providers", {
    method: "POST",
    body: JSON.stringify({
      name: "Remote Example",
      baseUrl: "https://api.example.com/v1",
      apiFormat: "openai-completions",
      apiKey: "test-key",
    }),
  });
  const remoteProviderId = remoteProvider.body?.provider?.id;
  check("remote provider created for the gate checks", remoteProvider.status === 201 && Boolean(remoteProviderId));

  /* --- Section 3.1 / 3.13: the Privacy Center payload -------------------- */

  const privacy = await jsonFetch("/api/privacy");
  const modes = Object.keys(privacy.body?.modes ?? {});
  check(
    "privacy endpoint reports settings, summary, destinations and providers",
    privacy.status === 200 &&
      typeof privacy.body?.settings?.defaultMode === "string" &&
      typeof privacy.body?.summary?.chats === "number" &&
      Array.isArray(privacy.body?.destinations) &&
      Array.isArray(privacy.body?.providers),
    `defaultMode=${privacy.body?.settings?.defaultMode}`
  );
  check(
    "all four privacy modes are described",
    modes.sort().join(",") === "incognito,local,private,standard",
    modes.join(",")
  );
  const mockPolicy = (privacy.body?.providers ?? []).find((entry) => entry.id === providerId);
  check(
    "a loopback provider is labelled local, not third party",
    mockPolicy?.local === true && mockPolicy?.label === "Local endpoint",
    mockPolicy?.label
  );

  const settingsPatch = await jsonFetch("/api/privacy", {
    method: "PATCH",
    body: JSON.stringify({ minimumProviderPolicy: "any", defaultMode: "standard", customRedactionTerms: [CANARY_TERM] }),
  });
  check(
    "privacy settings round-trip",
    settingsPatch.status === 200 &&
      settingsPatch.body?.settings?.minimumProviderPolicy === "any" &&
      (settingsPatch.body?.settings?.customRedactionTerms ?? []).includes(CANARY_TERM),
    JSON.stringify(settingsPatch.body?.settings?.customRedactionTerms)
  );

  /* --- Section 3.3: Private mode + Section 3.7: reversible redaction ----- */

  const privateChat = await jsonFetch("/api/chats", {
    method: "POST",
    body: JSON.stringify({ title: "Privacy check", privacyMode: "private", providerId, modelId }),
  });
  const privateChatId = privateChat.body?.chat?.id;
  check(
    "private chat created with the mode recorded",
    privateChat.status === 201 && privateChat.body?.chat?.privacyMode === "private",
    privateChat.body?.chat?.privacyMode ?? privateChat.body?.error
  );

  const echoed = await streamChat({
    chatId: privateChatId,
    message: `echo this straight back please: my address is ${CANARY_EMAIL}`,
  });
  check("private turn streams a reply", echoed.ok && echoed.text.length > 0, `${echoed.text.length} chars`);
  check("reply restores the real email", echoed.text.includes(CANARY_EMAIL), echoed.text.slice(0, 90));
  check("reply carries no leftover placeholder", !/\[EMAIL_\d+\]/.test(echoed.text));
  check(
    "redactions are announced on the stream",
    (echoed.redactions?.total ?? 0) >= 1 && (echoed.redactions?.items ?? []).some((item) => item.kind === "email"),
    `total=${echoed.redactions?.total} kinds=${(echoed.redactions?.items ?? []).map((item) => item.kind).join(",")}`
  );
  check(
    "the redaction summary only carries a masked preview",
    (echoed.redactions?.items ?? []).every((item) => !item.preview.includes(CANARY_EMAIL)),
    (echoed.redactions?.items ?? []).map((item) => item.preview).join(", ")
  );

  const storedDetail = await jsonFetch(`/api/chats/${privateChatId}`);
  const storedMessages = storedDetail.body?.messages ?? [];
  const storedAssistant = [...storedMessages].reverse().find((message) => message.role === "assistant");
  check(
    "the stored assistant message holds the restored value",
    messageText(storedAssistant?.content).includes(CANARY_EMAIL),
    `${messageText(storedAssistant?.content).length} chars`
  );
  check(
    "the stored user message is unchanged",
    storedMessages.some((message) => message.role === "user" && messageText(message.content).includes(CANARY_EMAIL))
  );

  /* --- Section 3.2: the metadata-only egress log ------------------------- */

  const egress = await jsonFetch(`/api/privacy/egress?chatId=${privateChatId}`);
  const events = egress.body?.events ?? [];
  const providerEvent = events.find((event) => event.kind === "provider");
  check("the outbound provider call is logged", Boolean(providerEvent), providerEvent?.destination ?? "no provider event");
  check(
    "the provider event records the redaction count",
    (providerEvent?.redactionCount ?? 0) >= 1,
    `redactionCount=${providerEvent?.redactionCount}`
  );
  check(
    "the log stores a payload hash instead of content",
    /^[0-9a-f]{64}$/.test(providerEvent?.payloadHash ?? ""),
    (providerEvent?.payloadHash ?? "(none)").slice(0, 12)
  );
  check(
    "no plaintext from the prompt appears anywhere in the log",
    !JSON.stringify(egress.body).includes("canary-7f3a") && !JSON.stringify(egress.body).includes(CANARY_TERM),
    `${events.length} event(s)`
  );

  /* --- Section 3.6: credentials are block-and-ask ------------------------ */

  const beforeBlock = (await jsonFetch(`/api/chats/${privateChatId}`)).body?.messages?.length ?? 0;
  const credentialBlock = await streamChat({
    chatId: privateChatId,
    message: `please remember my password=${CANARY_PASSWORD} for later`,
  });
  check(
    "a credential is blocked with its own code",
    credentialBlock.ok === false && credentialBlock.status === 409 && credentialBlock.code === "credentials",
    `${credentialBlock.status} ${credentialBlock.code ?? credentialBlock.message?.slice(0, 40)}`
  );
  check(
    "the blocked credential turn is never persisted",
    ((await jsonFetch(`/api/chats/${privateChatId}`)).body?.messages?.length ?? -1) === beforeBlock,
    `${beforeBlock} message(s) before`
  );

  const credentialAllowed = await streamChat({
    chatId: privateChatId,
    message: `please remember my password=${CANARY_PASSWORD} for later`,
    allowCredentials: true,
  });
  check(
    "the same turn sends once the user allows it",
    credentialAllowed.ok === true && credentialAllowed.text.length > 0,
    `${credentialAllowed.text.length} chars`
  );

  /* --- Section 3.4: the provider policy gate ----------------------------- */

  await jsonFetch("/api/privacy", { method: "PATCH", body: JSON.stringify({ minimumProviderPolicy: "zero-retention" }) });
  const gated = await streamChat({
    chatId: privateChatId,
    providerId: remoteProviderId,
    modelId,
    message: "hello from a provider below the minimum policy",
  });
  check(
    "private mode blocks a remote provider below the minimum policy",
    gated.ok === false && gated.status === 409 && gated.code === "policy-gate",
    `${gated.status} ${gated.code ?? gated.message?.slice(0, 40)}`
  );
  check(
    "the blocked send offers the user a way forward",
    (gated.body?.gate?.options ?? []).length > 0,
    (gated.body?.gate?.options ?? []).map((option) => option.kind).join(",")
  );
  await jsonFetch("/api/privacy", { method: "PATCH", body: JSON.stringify({ minimumProviderPolicy: "any" }) });

  /* --- Section 3.3: Strict Local mode ------------------------------------ */

  const localChat = await jsonFetch("/api/chats", {
    method: "POST",
    body: JSON.stringify({ title: "Strict local check", privacyMode: "local", providerId, modelId }),
  });
  const localChatId = localChat.body?.chat?.id;
  check("strict local chat created", localChat.status === 201 && Boolean(localChatId));

  const strictBlocked = await streamChat({
    chatId: localChatId,
    providerId: remoteProviderId,
    modelId,
    message: "hello",
  });
  check(
    "strict local refuses a remote endpoint",
    strictBlocked.ok === false && strictBlocked.status === 409 && strictBlocked.code === "strict-local",
    `${strictBlocked.status} ${strictBlocked.code ?? strictBlocked.message?.slice(0, 40)}`
  );

  const localTurn = await streamChat({ chatId: localChatId, message: "hello from strict local" });
  check(
    "strict local still talks to a loopback endpoint",
    localTurn.ok && localTurn.text.length > 0,
    `${localTurn.text.length} chars`
  );

  /* --- Retention purge and log clearing ---------------------------------- */

  const purged = await jsonFetch("/api/privacy", {
    method: "POST",
    body: JSON.stringify({ action: "purge", retentionDays: 30 }),
  });
  check(
    "retention purge runs and reports counts",
    purged.status === 200 && purged.body?.ok === true && typeof purged.body?.result?.chats === "number",
    JSON.stringify(purged.body?.result ?? purged.body)
  );

  const cleared = await jsonFetch("/api/privacy", { method: "POST", body: JSON.stringify({ action: "clear-egress" }) });
  check("the egress log can be cleared", cleared.status === 200 && cleared.body?.cleared >= 1, `cleared=${cleared.body?.cleared}`);

  /* --- Section 3.5: the "what will be sent" inspector -------------------- */

  await jsonFetch("/api/tools", {
    method: "PATCH",
    body: JSON.stringify({ webSearch: { enabled: true }, searchApiKey: "fake-search-key" }),
  });

  await jsonFetch("/api/privacy", { method: "PATCH", body: JSON.stringify({ defaultMode: "standard" }) });
  const standardPreview = await jsonFetch("/api/privacy/preview", {
    method: "POST",
    body: JSON.stringify({ modelId, providerId, message: "hello" }),
  });
  const standardTools = standardPreview.body?.preview?.tools ?? [];
  check(
    "the inspector resolves the tool egress destination",
    standardTools.some(
      (tool) => tool.name === "web_search" && tool.egress.kind === "thirdParty" && tool.egress.destination === "api.tavily.com"
    ),
    standardTools.map((tool) => `${tool.name}:${tool.egress.kind}`).join(",")
  );
  // The mock provider is loopback, so the inspector must label it local; a remote
  // provider must be labelled as a third-party destination instead.
  check(
    "the inspector labels a loopback endpoint as local",
    standardPreview.body?.preview?.destination?.kind === "local" &&
      standardPreview.body?.preview?.destination?.host === "127.0.0.1",
    `${standardPreview.body?.preview?.destination?.label} @ ${standardPreview.body?.preview?.destination?.host}`
  );
  const remotePreview = await jsonFetch("/api/privacy/preview", {
    method: "POST",
    body: JSON.stringify({ modelId, providerId: remoteProviderId, message: "hello" }),
  });
  check(
    "the inspector names a remote destination provider",
    remotePreview.body?.preview?.destination?.kind === "provider" &&
      remotePreview.body?.preview?.destination?.host === "api.example.com",
    `${remotePreview.body?.preview?.destination?.label} @ ${remotePreview.body?.preview?.destination?.host}`
  );

  await jsonFetch("/api/privacy", { method: "PATCH", body: JSON.stringify({ defaultMode: "local" }) });
  const localPreview = await jsonFetch("/api/privacy/preview", {
    method: "POST",
    body: JSON.stringify({ modelId, providerId, message: "hello" }),
  });
  const localTools = localPreview.body?.preview?.tools ?? [];
  check(
    "strict local withholds every third-party tool before sending",
    localTools.length > 0 && !localTools.some((tool) => tool.egress.kind === "thirdParty"),
    localTools.map((tool) => `${tool.name}:${tool.egress.kind}`).join(",")
  );
  check(
    "strict local keeps the on-device tools",
    localTools.some((tool) => tool.name === "calculator") && localTools.some((tool) => tool.name === "run_javascript"),
    localTools.map((tool) => tool.name).join(",")
  );

  await jsonFetch("/api/privacy", { method: "PATCH", body: JSON.stringify({ defaultMode: "private" }) });
  const redactedPreview = await jsonFetch("/api/privacy/preview", {
    method: "POST",
    body: JSON.stringify({ modelId, providerId, message: `my email is ${CANARY_EMAIL} and the project is ${CANARY_TERM}` }),
  });
  const preview = redactedPreview.body?.preview;
  const previewItems = preview?.redactions?.items ?? [];
  check(
    "the inspector previews the redactions it would apply",
    (preview?.redactions?.total ?? 0) >= 2 && previewItems.some((item) => item.kind === "email"),
    `total=${preview?.redactions?.total} kinds=${previewItems.map((item) => item.kind).join(",")}`
  );
  check(
    "the inspector honours custom redaction terms",
    previewItems.some((item) => item.kind === "custom"),
    previewItems.map((item) => `${item.kind}:${item.preview}`).join(",")
  );
  check(
    "the inspector never returns the plaintext",
    !JSON.stringify(preview ?? {}).includes(CANARY_EMAIL) && !JSON.stringify(preview ?? {}).includes(CANARY_TERM)
  );
  check(
    "the inspector reports only a payload hash",
    /^[0-9a-f]{64}$/.test(preview?.payloadHash ?? ""),
    (preview?.payloadHash ?? "(none)").slice(0, 12)
  );
  await jsonFetch("/api/privacy", { method: "PATCH", body: JSON.stringify({ defaultMode: "standard" }) });

  /* --- Section 3.8-3.10: delete everything ------------------------------- */

  const deleted = await jsonFetch("/api/privacy", { method: "POST", body: JSON.stringify({ action: "delete-all" }) });
  check(
    "delete-all reports what it removed",
    deleted.status === 200 && deleted.body?.ok === true && (deleted.body?.result?.deleted?.chats ?? 0) >= 1,
    JSON.stringify(deleted.body?.result?.deleted ?? {})
  );
  const chatsAfter = await jsonFetch("/api/chats");
  check("no chats survive delete-all", (chatsAfter.body?.chats ?? []).length === 0, `${chatsAfter.body?.chats?.length} chat(s)`);
  const providersAfter = await jsonFetch("/api/providers");
  check(
    "providers survive unless the user opts in",
    (providersAfter.body?.providers ?? []).length >= 2,
    `${providersAfter.body?.providers?.length} provider(s)`
  );
  const privacyAfter = await jsonFetch("/api/privacy");
  check(
    "privacy settings are reset to defaults after delete-all",
    privacyAfter.body?.settings?.customRedactionTerms?.length === 0 &&
      privacyAfter.body?.settings?.defaultMode === "standard",
    JSON.stringify(privacyAfter.body?.settings ?? {})
  );
}

try {
  await main();
} catch (error) {
  check("privacy check ran to completion", false, error instanceof Error ? error.message : String(error));
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} privacy checks passed`);
process.exitCode = failed ? 1 : 0;
