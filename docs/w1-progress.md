# W1 Progress Log

Date: 2026-10-16

W1 step 1 done

- Backup snapshot ref: refs/backup/pre-w1
- Backup snapshot hash: ad7016f950a728b04d0cbc8e9540552ad31e4ef2
- Working tree changes at snapshot time: 39

- node: v24.15.0
- npm: 11.12.1

- Installed: @sqlite.org/sqlite-wasm@3.53.4-build2 (exact pin)
- SQLite libVersion: 3.53.4
- FTS5 compiled in: yes

Next: W1 step 2 - device engine worker (opfs-sahpool + leader election)

## W1 step 2a done (2026-10-17)
Device database engine core, proven in Node.

Files created:
- scripts/gen-device-migrations.mjs (generates the device migration list from drizzle/)
- lib/device/engine/migrations.generated.ts (8 migrations, hashes identical to drizzle's)
- lib/device/engine/database.ts (DbEngine wrapper: run/all/get/values/batch/quickCheck/tableNames)
- lib/device/engine/migrator.ts (drizzle-identical bookkeeping + too-new guard + pre-migration hook)
- lib/device/engine/open.ts (openDeviceDatabase: opfs-sahpool preferred, memory fallback, export/deserialize)
- lib/device/engine/drizzle.ts (drizzle sqlite-proxy driver over a DeviceExecutor)
- scripts/device-engine-check.ts (21 checks)
- npm scripts: device:migrations, device:migrations:check, device:check

Files modified:
- package.json (three scripts; plus @sqlite.org/sqlite-wasm 3.53.4-build2 pinned in step 1)
- lib/db/schema.ts (removed the node:crypto import; uuid() now uses globalThis.crypto.randomUUID
  with a Math.random fallback, so the same schema can be imported by browser code)

Journal mode: deliberately NOT set to WAL. The opfs-sahpool VFS holds at most a small pool of
handles and WAL needs extra shared-memory files; the default rollback journal is what SQLite
supports there. Batches use BEGIN IMMEDIATE. To be confirmed against a real browser in step 2b.

Bugs the check suite caught (all fixed):
1. sqlite-wasm throws "This statement has no bindable parameters" when an EMPTY array is bound,
   so absent params must stay absent rather than becoming [].
2. The check script exported a database through a sqlite3 instance that did not own it; a wasm
   pointer is only valid inside its own instance, so the image came back empty.

Results: device:check PASS 21/21; typecheck clean; lint clean.
Notable proof: a server database file (better-sqlite3 + drizzle migrator) imports into the device
engine and reports zero pending migrations; all application tables are byte-identical.

Next: W1 step 2b - Worker (opfs-sahpool, Web Locks leader election, BroadcastChannel forwarding,
IndexedDB snapshot fallback) + main-thread client + self-test page.


## W1 step 2b done (2026-10-17)
Worker + RPC contract + IndexedDB snapshot store.

Files created:
- lib/device/protocol.ts (pure RPC types/constants; imports only a type, so sqlite-wasm
  never reaches the main-thread bundle)
- lib/device/idb.ts (tiny IndexedDB store: engine choice, snapshot, meta; deliberately no file bytes)
- lib/device/worker.ts (one Worker per tab; leader/follower)

Design decisions recorded:
- Single writer by Web Locks. The worker tries DEVICE_LEADER_LOCK with ifAvailable first; if it wins
  it opens the engine and answers other tabs; if it loses it becomes a follower and queues for the
  lock, so it takes over when the leader tab closes. The lock is held for the lifetime of the tab.
- Followers never touch the database. They forward ops over a BroadcastChannel
  (DEVICE_CHANNEL_NAME) with a 10s timeout; a client-side retry is therefore a requirement, because
  during a leadership hand-off there is briefly no listener.
- No silent engine fallback. The chosen engine is pinned per profile in IndexedDB. If a profile is
  pinned to OPFS and OPFS will not start, the worker reports engineError and serves nothing rather
  than opening an empty database that would look like data loss. A first run may choose memory and
  records why.
- Durability rule: the memory engine acknowledges a mutation only after the snapshot is written to
  IndexedDB. For OPFS, durability is the filesystem's job.
- wipe clears the OPFS pool (wipeFiles + removeVfs) and every IndexedDB key, then releases leadership.

Results: device:check PASS 21/21; typecheck clean; lint clean.
Not yet verified: the Worker has never run in a real browser. Browser verification (Chromium,
Firefox, WebKit) with Playwright is the next step, and no browser-support claim may be made
until it passes.

Next: W1 step 2c - main-thread client (RPC + retry), self-test page, then the ContentStore
interfaces and DeviceStore repositories (W1-B), stateless server mode (W1-C), and the
privacy data-flow + invariance test.


## Hostile red-team pass (2026-10-17)
Target: Conduit's preview/generation surface inside this repo. Method: HTTP-level and Node-level
attacks against a live dev server + mock provider, plus a read-only security audit of the code.
No browser automation exists in this repo, so anything the browser enforces is UNTESTED, not passed.

CONFIRMED at runtime
- P1 Forged tool approval. POST /api/chat/tool-result resolves a pending tool call with no user
  decision: {"id":"call_mock_py","decision":"run"} -> 200 {"ok":true}. A bogus id -> 404. There is no
  content-type gate: application/json and text/plain are both accepted, and text/plain is
  CORS-safelisted, so a cross-site simple fetch can reach it. form-urlencoded is rejected (400), so a
  plain HTML form cannot. Pending calls are keyed only by the provider tool-call id, with no chat or
  session correlation, and the id is visible in the client stream.
- P2 MIME-parameter bypass on /api/files. "text/html" -> content-disposition attachment + CSP
  sandbox. "text/html;charset=utf-8" -> content-disposition inline, no CSP, served as text/html on
  the app origin. The guard is an exact string compare, so any parameter or case variant slips it.
- P2 ReDoS in lib/craft/slop.ts (violet-gradient rule). Measured: n=100 10ms, n=200 65ms,
  n=400 505ms, n=800 4221ms (roughly cubic); n=2000 64s; n=4000 did not finish in 180s. POST
  /api/artifacts/[id]/review runs it on unbounded stored content with no size cap and no rate limit,
  so a large artifact can pin a request thread.
- P3 CSV/Excel formula injection. Extracted text preserves leading = cells; no neutralisation in
  lib/files/extract.ts or the exporter.
- P3 No rate limiting anywhere: 40 parallel requests to the site route produced zero 429s.

CONFIRMED by reading only (not yet proven at runtime)
- Unsanitised DOCX HTML: components/files/file-previewer.tsx injects mammoth convertToHtml output via
  dangerouslySetInnerHTML with no sanitiser. (Markdown is sanitised with rehype-sanitize; mermaid uses
  securityLevel strict.)
- Cross-origin workspace read: /api/workspace/preview sets access-control-allow-origin * with
  cross-origin-resource-policy cross-origin, so any web page can read non-secret workspace files it
  can name.
- xlsx pinned at ^0.18.5, which predates the upstream prototype-pollution fix (0.19.3).
- Indirect prompt injection surface: project instructions, skill instructions, memories, RAG
  excerpts, research page text and tool output are all concatenated into the system prompt raw, with
  no delimiters and no instruction that such text must not be obeyed.
- spawnSync in the coding workspace blocks the Node event loop for up to 120s.

UNTESTED (no way to test inside this repo)
- Artifact SITE route headers, traversal and 404 escaping: the mock provider only ever emits
  type="html" and there is no artifact-create API, so the site route could not be exercised (it 415s
  for non-site artifacts). This is the single most important remaining gap: the site route carries
  previewCsp() and has never been verified end to end since the global-CSP fix.
- Browser-enforced behaviour: iframe sandbox application, CSP enforcement, rendering, responsiveness,
  click behaviour, dark mode, keyboard access. No browser automation is installed.
- 50+ tab behaviour, quota/eviction, real memory growth.

Bugs this pass found in the testing itself (do not repeat)
- Comparing response ids at attachment.id when the API returns file.id.
- Using a non-site artifact to test the site route.
- Treating Next's own 404 HTML (which contains <script>) as reflected XSS.
- process.exit() truncates piped stdout, so results must be redirected to a file to be reliable.

## Fixes applied after the red-team pass (2026-10-17)

Test-only acceptance run. No product code changed by this pass; the pre-existing working tree was
already modified.

P1 approval binding (/api/chat/tool-result)
- A pending tool call is now bound to its owning chat. Settling requires BOTH the tool-call id and
  the chat id; waitForClientTool refuses to park a call without a chat id.
- The route refuses `sec-fetch-site: cross-site` (403), requires an application/json content type
  (415), and requires chatId in the body. Unknown ids and chat mismatches both answer 404 with the
  same wording ("That tool call is no longer waiting for a result."), so a probe cannot tell a live
  id from a dead one.
- Proven at runtime against id=call_mock_py, chat=a8ea87d8-14db-4b9d-9899-095cdb85ba3a:
  no chatId -> 422 (zod validation; the request is still refused, but the status is 422 rather than
  the 400 the run expected); wrong chatId -> 404; text/plain -> 415; cross-site -> 403; legitimate
  request with no sec-fetch-site header -> 200 {"ok":true}; id "not-a-real-id" -> 404 with wording
  identical to the wrong-chatId case.

P2 MIME normalisation on /api/files/{id}
- The stored MIME is split on the first ';', trimmed and lowercased before the guard, so case and
  parameter variants can no longer bypass it.
- HTML and XHTML are never re-served as text/html: they are re-typed to text/plain; charset=utf-8,
  forced to content-disposition attachment, and get a sandbox CSP. SVG keeps image/svg+xml (an img
  cannot execute it) but is forced to download.
- x-content-type-options: nosniff is now set on every response from this route, including 404/410
  and error responses. The global header set in next.config.ts skips /api/* so it cannot clobber the
  route's own CSP, which is why nosniff is set per response.
- Proven at runtime with a probe4.html upload for each of text/html, "text/html;charset=utf-8",
  "Text/HTML", "text/html; charset=UTF-8" and application/xhtml+xml: all five returned
  content-type "text/plain; charset=utf-8", an attachment disposition, CSP sandbox and nosniff.
  A 1x1 PNG still returns inline, image/png, with nosniff.

P2 ReDoS rewrite in lib/craft/slop.ts (violet-gradient rule)
- The unbounded lookahead was replaced with a bounded repetition, linear-gradient(...){0,200}.
- Measured by this pass: n=20000 completes in 1.9-10.2ms depending on input shape (plain text,
  a gradient prefix, or 20,000 candidate stops), versus roughly cubic behaviour before
  (n=2000 took 64s and n=4000 did not finish in 180s).
- Also confirmed by probing the rule directly: uppercase hex, uppercase function names, mixed-case
  hex, newlines inside rgb(...) and a comment between the gradient stops are all still detected.
  These are the three evasion classes that were fixed: letter case, arbitrary whitespace inside
  rgb(), and a bounded length on the gradient argument.

Review route caps (/api/artifacts/{id}/review)
- 2,000,000 byte content cap (413 names the limit and the observed size) and a 64-file cap for site
  bundles.
- Proven: a seeded 2,100,007-byte html artifact returned 413 with "Artifact is 2,100,007 bytes,
  which exceeds the 2,000,000-byte review limit." A small stored artifact returned 200 with a review
  payload (score 100, no findings).

Static gates (all observed this pass)
- typecheck: exit 0, no diagnostics. lint: exit 0. craft:check PASS 83/83.
  redact:check PASS 24/24. device:check PASS 21/21. device:migrations:check: migrations up to date.

Live regression
- smoke: 132/132. files:check: 12/12.
- Note: the first smoke run scored 131/132 because the persisted tools config had
  code.autoApprove=true. The intended default in lib/tools/web-search.ts is false, so the runtime
  config was restored to false and the suite re-run to 132/132. This was stored state, not a code
  defect.

Test debris
- Deleted the untracked red-team scripts: scripts/redteam-engine.ts, scripts/redteam-engine-rest.ts,
  scripts/redteam-http.mjs, scripts/redteam-http-2.mjs.
- Chats created by this run were deleted; the chat count returned to its 47-chat baseline.
- Left behind, because neither files nor artifacts have a delete API: six attachment rows from the
  MIME probes (probe4.html x5, probe4.png). No artifact rows were left behind.
