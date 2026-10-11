/**
 * Coding-workspace checks (agentic coding tools + in-chat model selector).
 *
 * Requires the app (`npm run dev`) and the mock provider
 * (`node scripts/mock-provider.mjs`) to be running.
 *
 *   node scripts/coding-check.mjs [appUrl] [providerBaseUrl]
 *
 * WARNING: this mutates the database the app is pointed at. It adds a provider,
 * a few chats, and turns the coding workspace on (pointed at a scratch folder in
 * the OS temp directory). Point SQLITE_PATH at a scratch file if you would rather
 * leave the dev database alone.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REQUEST_TIMEOUT_MS = 120_000;

const appUrl = process.argv[2] ?? "http://localhost:3000";
const providerBaseUrl = process.argv[3] ?? "http://127.0.0.1:4123/v1";

const CODING_TOOLS = ["list_files", "read_file", "write_file", "edit_file", "search_files", "run_command"];

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function jsonFetch(route, init) {
  const response = await fetch(`${appUrl}${route}`, {
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
  return { status: response.status, body };
}

/**
 * Streams one chat turn. Tool approvals arrive mid-stream, so the callback runs
 * the moment the server parks the call — exactly what the browser does.
 */
async function streamTurn(payload, decide = () => "run") {
  const response = await fetch(`${appUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok || !response.body) {
    const raw = await response.text();
    return { ok: false, status: response.status, message: raw.slice(0, 200), text: "", approvals: [], toolResults: [], errors: [] };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let chatId = payload.chatId ?? null;
  const approvals = [];
  const toolResults = [];
  const errors = [];

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
      if (event.type === "error") errors.push(event.message);
      if (event.type === "tool_result") toolResults.push(event);
      if (event.type === "tool_approval") {
        approvals.push(event);
        const decision = decide(event);
        await jsonFetch("/api/chat/tool-result", {
          method: "POST",
          body: JSON.stringify(
            decision === "deny"
              ? { id: event.id, decision: "deny" }
              : { id: event.id, decision: "run", output: "", isError: false }
          ),
        });
      }
    }
  }

  return { ok: true, status: response.status, chatId, text, approvals, toolResults, errors };
}

async function configureCoding(patch) {
  const response = await jsonFetch("/api/tools", { method: "PATCH", body: JSON.stringify({ coding: patch }) });
  return response;
}

async function main() {
  const health = await jsonFetch("/api/health");
  check("health endpoint responds", health.status === 200, `database: ${health.body?.database?.reachable}`);

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-workspace-"));
  fs.writeFileSync(path.join(workspace, ".env"), "SEKRIT=do-not-send\n");

  /* --- Configuration surface -------------------------------------------- */

  const offState = await jsonFetch("/api/tools");
  check(
    "coding tools are hidden until the workspace is switched on",
    !(offState.body?.available ?? []).some((name) => CODING_TOOLS.includes(name)),
    (offState.body?.available ?? []).join(",")
  );

  const onState = await configureCoding({
    enabled: true,
    root: workspace,
    allowCommands: true,
    autoApproveWrites: false,
    maxReadBytes: 200_000,
  });
  const available = onState.body?.available ?? [];
  check(
    "every coding tool becomes available when enabled",
    CODING_TOOLS.every((name) => available.includes(name)),
    available.filter((name) => CODING_TOOLS.includes(name)).join(",")
  );
  check(
    "the resolved workspace root is reported back",
    onState.body?.workspace?.root === path.resolve(workspace) && onState.body?.workspace?.enabled === true,
    onState.body?.workspace?.root
  );
  const writeSpec = (onState.body?.specs ?? []).find((spec) => spec.name === "write_file");
  check(
    "write_file is a server tool that asks first",
    writeSpec?.source === "builtin" && writeSpec?.execution === "server" && writeSpec?.requiresApproval === true,
    JSON.stringify({ execution: writeSpec?.execution, requiresApproval: writeSpec?.requiresApproval })
  );
  check(
    "coding tools are classified as local egress",
    (onState.body?.specs ?? [])
      .filter((spec) => CODING_TOOLS.includes(spec.name))
      .every((spec) => spec.egress?.kind === "local"),
    (onState.body?.specs ?? []).find((spec) => spec.name === "write_file")?.egress?.kind
  );

  /* --- Provider + model bootstrap ---------------------------------------- */

  const createdProvider = await jsonFetch("/api/providers", {
    method: "POST",
    body: JSON.stringify({
      name: "Mock Coding",
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

  const chat = await jsonFetch("/api/chats", {
    method: "POST",
    body: JSON.stringify({ title: "Coding check", providerId, modelId }),
  });
  const chatId = chat.body?.chat?.id;
  check("coding chat created", chat.status === 201 && Boolean(chatId));

  /* --- The agent loop: write, read, list --------------------------------- */

  const written = await streamTurn({ chatId, message: "Please write a file for me.", toolsEnabled: CODING_TOOLS });
  const writeApproval = written.approvals.find((event) => event.name === "write_file");
  check(
    "the model's write_file call reaches the user for approval",
    Boolean(writeApproval) && writeApproval.execution === "server" && writeApproval.requiresApproval === true,
    writeApproval ? `${writeApproval.name} ${JSON.stringify(writeApproval.input)}` : "no approval event"
  );
  const writeResult = written.toolResults.find((event) => event.name === "write_file");
  check(
    "approving the write creates the file in the workspace",
    Boolean(writeResult) && !writeResult.isError && writeResult.output.includes("Created notes/hello.txt"),
    writeResult?.output?.split("\n")[0]
  );
  const helloPath = path.join(workspace, "notes", "hello.txt");
  check(
    "the file exists on disk with the model's content",
    fs.existsSync(helloPath) && fs.readFileSync(helloPath, "utf8").includes("hello from the mock provider"),
    fs.existsSync(helloPath) ? `${fs.readFileSync(helloPath, "utf8").length} bytes` : "missing"
  );
  check("the answer streams after the tool round", written.text.length > 0, `${written.text.length} chars`);

  const listed = await streamTurn({ chatId, message: "Please list the workspace.", toolsEnabled: CODING_TOOLS });
  const listResult = listed.toolResults.find((event) => event.name === "list_files");
  check(
    "list_files shows the new file",
    Boolean(listResult) && !listResult.isError && listResult.output.includes("notes/hello.txt"),
    listResult?.output?.split("\n").slice(0, 3).join(" / ")
  );

  const read = await streamTurn({ chatId, message: "Please read the file back.", toolsEnabled: CODING_TOOLS });
  const readApproval = read.approvals.find((event) => event.name === "read_file");
  const readResult = read.toolResults.find((event) => event.name === "read_file");
  check(
    "reading a file is allowed without an approval prompt",
    !readApproval && Boolean(readResult) && !readResult.isError,
    readApproval ? "asked for approval" : readResult?.output?.split("\n")[0]
  );
  check(
    "the file body comes back with line numbers",
    Boolean(readResult) && readResult.output.includes("hello from the mock provider") && /^1: /m.test(readResult.output),
    readResult?.output?.split("\n").slice(0, 2).join(" / ")
  );

  /* --- Guard rails ------------------------------------------------------- */

  const escaped = await streamTurn({ chatId, message: "Please escape the workspace.", toolsEnabled: CODING_TOOLS });
  const escapeResult = escaped.toolResults.find((event) => event.name === "write_file" && event.isError);
  check(
    "a path that climbs out of the workspace is refused",
    Boolean(escapeResult) && /outside the workspace/i.test(escapeResult.output),
    escapeResult?.output
  );
  check(
    "nothing was written next to the workspace root",
    !fs.existsSync(path.join(path.dirname(workspace), "escaped.txt"))
  );

  const secret = await streamTurn({ chatId, message: "Please read the env file.", toolsEnabled: CODING_TOOLS });
  const secretResult = secret.toolResults.find((event) => event.name === "read_file" && event.isError);
  check(
    "the .env file is refused as a secret",
    Boolean(secretResult) && /secret/i.test(secretResult.output),
    secretResult?.output
  );

  const denied = await streamTurn({ chatId, message: "Please write a file again.", toolsEnabled: CODING_TOOLS }, () => "deny");
  const deniedApproval = denied.approvals.find((event) => event.name === "write_file");
  const deniedResult = denied.toolResults.find((event) => event.name === "write_file" && event.isError);
  check(
    "declining a write tells the model and changes nothing",
    Boolean(deniedApproval) && Boolean(deniedResult) && /declined/i.test(deniedResult.output),
    deniedResult?.output
  );
  check(
    "the declined write did not touch the file",
    fs.readFileSync(helloPath, "utf8") === "hello from the mock provider\n"
  );

  const command = await streamTurn({ chatId, message: "Please run a command in the folder.", toolsEnabled: CODING_TOOLS });
  const commandApproval = command.approvals.find((event) => event.name === "run_command");
  const commandResult = command.toolResults.find((event) => event.name === "run_command");
  check(
    "run_command asks first and then reports its exit code",
    Boolean(commandApproval) && Boolean(commandResult) && /exit code: 0/.test(commandResult.output),
    commandResult?.output?.split("\n").slice(0, 3).join(" / ")
  );
  check(
    "the command actually ran in the workspace",
    Boolean(commandResult) && commandResult.output.includes("codex-mock-ok"),
    commandResult?.output?.includes("codex-mock-ok") ? "stdout captured" : "missing stdout"
  );

  /* --- Settings toggles -------------------------------------------------- */

  const autoApproved = await configureCoding({ autoApproveWrites: true });
  const autoSpec = (autoApproved.body?.specs ?? []).find((spec) => spec.name === "write_file");
  check(
    "auto-approve writes clears the write approval flag",
    autoSpec?.requiresApproval === false,
    String(autoSpec?.requiresApproval)
  );
  const autoTurn = await streamTurn({ chatId, message: "Please write a file once more.", toolsEnabled: CODING_TOOLS });
  check(
    "an auto-approved write runs without a prompt",
    !autoTurn.approvals.some((event) => event.name === "write_file") &&
      autoTurn.toolResults.some((event) => event.name === "write_file" && !event.isError),
    `${autoTurn.approvals.length} approvals`
  );

  await configureCoding({ autoApproveWrites: false, allowCommands: false });
  const noCommands = await jsonFetch("/api/tools");
  const availableWithoutCommands = noCommands.body?.available ?? [];
  check(
    "turning commands off removes run_command but keeps the file tools",
    !availableWithoutCommands.includes("run_command") && availableWithoutCommands.includes("read_file"),
    availableWithoutCommands.filter((name) => CODING_TOOLS.includes(name)).join(",")
  );

  const disabled = await configureCoding({ enabled: false });
  check(
    "switching the workspace off hides every coding tool again",
    !(disabled.body?.available ?? []).some((name) => CODING_TOOLS.includes(name)),
    (disabled.body?.available ?? []).filter((name) => CODING_TOOLS.includes(name)).join(",")
  );

  /* --- Model selector plumbing ------------------------------------------- */

  const models = await jsonFetch("/api/models");
  const option = (models.body?.models ?? []).find((entry) => entry.id === modelId);
  check(
    "the model list carries provider names for the in-chat selector",
    Boolean(option) && typeof option.providerName === "string" && option.providerName.length > 0,
    option?.providerName
  );

  const switched = await jsonFetch(`/api/chats/${chatId}`, {
    method: "PATCH",
    body: JSON.stringify({ modelId }),
  });
  check(
    "a chat remembers the model chosen in the composer",
    switched.status === 200 && switched.body?.chat?.modelId === modelId,
    switched.body?.chat?.modelId
  );

  /* --- Cleanup ----------------------------------------------------------- */

  fs.rmSync(workspace, { recursive: true, force: true });

  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} coding checks passed`);
  if (passed !== results.length) {
    console.log("Failed:");
    for (const result of results.filter((entry) => !entry.ok)) console.log(`  - ${result.name}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});