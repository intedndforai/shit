# Conduit privacy

Conduit is a self-hosted, provider-agnostic chat client. It ships with no hardcoded AI
vendor, no telemetry, and no analytics. This document describes exactly what Conduit
stores, what it sends, to whom, and how to delete it — plus the limits of what it can
guarantee.

## Honest scope

No application can force a third-party model provider to behave in a particular way. The
guarantees are therefore split into three zones:

| Zone | Who controls it | What Conduit can promise |
| --- | --- | --- |
| **A. The app** (browser, server, SQLite, logs, caches) | You | Hard guarantees, tested. |
| **B. Your model providers** | The provider | Conduit minimizes, redacts, and requests documented data controls, but cannot verify provider behavior. |
| **C. Tools and third parties** (search backends, MCP servers, HTTP tools, the Pyodide CDN, speech engines) | The third party | They receive only what you approve for that call. |

Only **Strict Local mode** with a loopback or private-network model endpoint keeps content
on your own machine or network. Everything else leaves the app process.

Conduit never claims "the AI never sees your data", "zero retention", or "not used for
training". Provider policy values are **user-declared** and are never labelled verified.

## Privacy modes

A workspace default (Privacy Center) plus a per-chat override (the composer).

| Mode | Storage | Redaction | Policy gate | Tools | Memory | Titles |
| --- | --- | --- | --- | --- | --- | --- |
| **Standard** | SQLite | off | off | normal | opt-in | AI title |
| **Private** | SQLite | **on** (reversible) | **enforced** against your minimum policy | third-party tools ask every time | **off** | local fallback (AI title needs an approved destination) |
| **Incognito** | **nothing** | on | enforced | ask every time | not read or written | local fallback |
| **Strict Local** | SQLite | **on** | local endpoints only | third-party tools, web search/fetch, MCP, remote embeddings, Pyodide/remote speech all disabled | off unless enabled | local fallback |

Incognito chats are excluded from the sidebar list, search, export, share links, and usage
records. A reload ends the chat by design.

## What is stored and where

Server-side SQLite (`SQLITE_PATH`, default `data/conduit.db`):

| Data | Table | Notes |
| --- | --- | --- |
| Chats, titles, per-chat settings, privacy mode | `chats` | |
| Messages (branched tree) and tool calls/results | `messages` | JSON content parts |
| Attachments: name, MIME, size, extracted text, storage path | `attachments` | Bytes live on disk under generated identifiers; extracted text is in the database |
| Artifacts and versions | `artifacts` | |
| Projects, project files, and retrieval chunks + embeddings | `projects`, `project_files`, `project_chunks` | |
| Memory facts | `memories` | Opt-in, off by default |
| Response styles, saved prompts | `response_styles`, `saved_prompts` | |
| Usage events (model, tokens, cost, duration — **no content**) | `usage_events` | |
| Egress log (kind, destination host, byte count, redaction count, payload hash — **no content**) | `egress_events` | |
| Providers, encrypted API keys, user-declared data policy | `providers` | Keys are AES-256-GCM encrypted with `CONDUIT_SECRET`; never returned to the browser |
| Privacy settings | `app_settings` | |

Browser-side: theme and accent, sidebar state, the composer draft, and tool-run state. In
Incognito nothing is persisted at all; in Strict Local, messages are still stored in the
local SQLite database (only the model endpoint is constrained).

SQLite is opened with `PRAGMA secure_delete = ON`. Retention purges and "delete all my
data" run a WAL checkpoint and `VACUUM` so freed bytes leave the database file.

## What is sent, and to whom

Every outbound request passes through a fixed pipeline:
**minimize → redact → provider data-policy gate → provider-specific data-control flags →
send**, and placeholders are restored on the way back.

| Feature | Sent | Destination | Notes |
| --- | --- | --- | --- |
| Chat completion | Active branch (or the transcript in Incognito/Local), system prompt layers, attachment text/images, tool schemas | The provider you configured for the model | Redacted first in Private and Strict Local |
| Title generation | First answer excerpt | The title model's provider | Skipped for Incognito/Strict Local; local fallback |
| Context summarization | The turns being summarized | The summarization model's provider | Only when you trigger it |
| Retrieval embeddings | Project chunks | The embeddings provider | Lexical (keyword) fallback keeps it local |
| Web search | The (redacted) query only — never the conversation | Your search backend (Tavily/Brave/Serper/self-hosted SearXNG/custom) | Disabled in Strict Local |
| URL fetch | The URL, with no cookies, keys, or app identifiers | The destination host | SSRF-guarded; query strings that look like chat content are flagged |
| MCP tools | The tool arguments | Your MCP server | Approval shows the destination and the exact payload |
| Custom HTTP tools | The request body | The endpoint you configured | Same approval rules |
| Browser Python | Your code, and Pyodide + packages from `cdn.jsdelivr.net` | jsDelivr | Classified third-party; disabled in Strict Local. JavaScript runs in a sandboxed worker with no network |
| Web Speech / TTS | Audio or text, if you use them | Your browser vendor's cloud, unless you configure a local endpoint | Planned (M10) with destination warnings |

Notes on provider data controls: where a provider documents a request-level control it is
implemented (for example OpenRouter provider routing with `data_collection="deny"` and
`zdr=true` when you request zero retention). If a provider documents no such control, the
UI says "not requested — provider does not expose this" instead of implying protection.
Conduit sends no user field, no client fingerprint, no forwarded IP, and no app-name or
referrer attribution headers by default.

## Redaction (Private and Strict Local)

Best-effort, **reversible** detection and replacement of emails, phone numbers, API keys,
tokens, bearer tokens, private keys, JWTs, passwords, Luhn-valid payment cards, mod-97
IBANs, national-ID-like patterns, IPv4 addresses, and file paths containing a username —
plus your own terms and regex patterns. Values become stable placeholders such as
`[EMAIL_1]` and `[SECRET_1]`; the mapping stays in server memory for the request only and
is never sent. Originals are restored in the streamed reply before display and before
saving, including when a placeholder is split across chunks. Detected **credentials**
default to block-and-ask: nothing is sent until you allow it once.

Detection is best-effort, not a guarantee. The "What will be sent" inspector shows exactly
which values were masked, and the reply carries a notice such as "3 values masked — the
answer may be less specific" so masking is never silent.

## Logs

Application logs contain no prompts, responses, file text, memory, tool arguments or
results, API keys, authorization headers, cookies, or custom-header values. The egress log
stores metadata only: kind, destination host, byte count, redaction count, status, and a
SHA-256 hash of the payload. Content never appears in URLs, query strings, storage keys,
error messages, or referrers.

## Deletion

- **Per chat / per project**: deleting a chat cascades to its messages, attachments,
  artifacts, share links, and egress rows; deleting a project file cascades to its chunks
  and embeddings, and re-indexing replaces them.
- **Retention**: set "keep" or auto-delete after *N* days in the Privacy Center and run the
  purge (or call `POST /api/privacy` with `{ "action": "purge" }`). The purge covers chats,
  messages, attachments, artifacts, and egress rows, then compacts the database.
- **Delete all my data**: `POST /api/privacy` with `{ "action": "delete-all" }`, or the
  button in the Privacy Center. It removes egress rows, usage events, share links, memory,
  artifacts, messages, attachments, chats, projects, chunks, and files, then checkpoints
  the WAL and runs `VACUUM` with `secure_delete` on. Provider credentials are kept unless
  you ask to include them.

Deleting data on your own machine cannot recall a copy a third-party provider already
received, and deleted data may persist in backups or filesystem snapshots you made
yourself.

## What Conduit does not protect against

- A third-party provider's logging, training, or retention behavior — user-declared policy
  labels are not verification.
- A self-hosting operator: they can read the SQLite database and the server process's
  memory, including the in-memory redaction mapping for an in-flight request.
- Browser extensions, other browser tabs, your OS, or anything with access to your files.
- Anyone you send an exported chat or a share link to.
- Telemetry you add yourself through a custom tool or MCP server.

## Verification

- `npx tsx scripts/redact-check.ts` — detector coverage, Luhn/mod-97 validation,
  credential classification, round-trip restoration, and placeholder-split streaming.
- `npm run privacy:check` — boots the app with a deterministic fake provider and asserts
  that Private mode blocks an undeclared provider, that the credential guard stops a
  detected secret until it is allowed once, that placeholders are restored in the saved
  answer, that third-party tools are withheld in Strict Local mode, that the egress log
  contains metadata but no content, and that the security headers are present.
- `npm run typecheck`, `npm run lint`, `npm run build`.

These checks are the extent of the claim. No privacy guarantee is made beyond what they
measure.
