# Deploying Conduit on Cloudflare

Conduit is a Next.js app with a Node server runtime: it keeps SQLite on disk
(`better-sqlite3`), writes uploaded attachments to `data/uploads`, parses PDF,
DOCX and XLSX files in-process, and guards outbound fetches with `node:dns` and
`node:net`. That shape decides which Cloudflare products can host it.

Summary of the three routes:

| Path | Cost | Code changes | Verified here |
| --- | --- | --- | --- |
| Workers + D1 + R2 | Free tier possible | Large: the whole data layer must become async | Not run (needs your account) |
| Containers | Paid Workers plan | None, uses the existing `Dockerfile` | Standalone server verified locally |
| Tunnel | Free | None | Works with the running app |

## What the repository configures for Workers

Two files at the repository root drive a Worker build, and both have to agree
with the Worker name in your Cloudflare account.

`wrangler.jsonc` names the Worker, points at the OpenNext entry point, turns on
the Node compatibility flag, and binds the static assets:

```jsonc
"name": "shit",
"main": ".open-next/worker.js",
"compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
"assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
"services": [{ "binding": "WORKER_SELF_REFERENCE", "service": "shit" }]
```

`open-next.config.ts` keeps the incremental cache, tag cache and queue overrides
at their defaults, so the Worker boots without an R2 bucket, a KV namespace, or
a Durable Object binding.

Both files are optional for the D1 refactor in Path A, and neither is used by
Path B or Path C.

### Cloudflare Workers Builds settings

When the Worker is connected to this Git repository, point the pipeline at the
scripts in `package.json` so it does not fall back to a guessed build:

| Setting | Value |
| --- | --- |
| Build command | `npm run cf:build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

`npm run cf:deploy` does both steps if you would rather keep one command. Also
check the Worker's Settings page for bindings that were added by hand earlier:
anything still naming a Worker that no longer exists fails the upload with error
10143 before the code is even considered.

### Error 10143: a service binding referenced a Worker that does not exist

```
Service binding 'WORKER_SELF_REFERENCE' references Worker 'conduit' which was
not found. Verify the Worker exists in your account and that the service name in
your configuration is correct. [code: 10143]
```

The bundle built fine; the upload aborted because a service binding pointed at a
name left over from an earlier attempt. `name` and `services[].service` must both
be the Worker that exists in the account. Rename the Worker in the dashboard and
you edit both values; leave one behind and the error returns. If your Cloudflare
project holds an older service binding from the dashboard, delete it there or
bring it in line with `wrangler.jsonc`.

The `[equals-negative-zero]` warning printed just above that error is unrelated
and harmless. It comes from minifying a dependency inside
`.open-next/server-functions/default/handler.mjs`, so there is nothing to fix in
this codebase.

### Building on Windows

The OpenNext build copies Next's traced output and recreates the symlinks Next
writes for externalized packages (`better-sqlite3`, `mammoth`, `xlsx`). Creating
a symlink on Windows needs Developer Mode or an elevated shell, so without one
the local build stops with:

```
Error: EPERM: operation not permitted, symlink ... better-sqlite3 ...
```

Turn on **Settings → System → For developers → Developer Mode** (or build in
WSL, a container, or CI) and the same command completes. Deploys are unaffected,
because Cloudflare's builders run on Linux.

## Why a plain upload to Pages or Workers fails

**Cloudflare Pages** serves static assets and runs only edge functions. Conduit
needs a long-lived Node process: `next build` with `output: "standalone"`
produces `server.js`, and the routes that matter (`/api/chat`, `/api/files`,
`/api/db`-backed settings) read and write files, open SQLite, and spawn the
migrator on boot. Pages has no filesystem, no `better-sqlite3`, and no place to
put `data/uploads`, so the upload either rejects the build or fails at the first
API call. `@cloudflare/next-on-pages` is also no longer the recommended path;
Cloudflare now points Next.js apps at Workers through OpenNext.

**Cloudflare Workers** can run Next.js through `@opennextjs/cloudflare`, but this
repository is not Worker-ready yet:

- **Synchronous database calls.** The data layer is 106 `getDb()` uses and 187
  synchronous Drizzle calls (`.get()`, `.all()`, `.run()`, `.values()`) spread
  across 25 files under `lib/server/**`. Workers have no local SQLite file, so
  every one of those calls has to become `await` against D1.
- **Filesystem storage.** `lib/files/storage.ts` writes attachment bytes under
  `data/uploads`, and `app/api/files/[id]/route.ts` streams them back; both need
  R2.
- **Runtime migrator.** `lib/db/index.ts` reads the `drizzle/` folder from
  `process.cwd()` and migrates on first use. Workers need `wrangler d1
  migrations` at deploy time instead.
- **Node-only helpers.** `lib/tools/fetch-url.ts` resolves hostnames through
  `node:dns/promises` and `node:net`, and `lib/files/extract.ts` resolves the
  pdf.js worker by path from `node_modules`.
- **Privacy trade-offs.** SQLite's `PRAGMA secure_delete` and `VACUUM` back the
  "delete all my data" promise. D1 has no equivalent, so that guarantee has to be
  reworded for a Worker deployment.
- **Bundle size.** `pdfjs-dist`, `mammoth`, `xlsx` and `jszip` together exceed
  the Worker size limit unless they move behind separate handlers.

If you want this path, the concrete work is: an async D1 repository layer
replacing the 25 synchronous files, R2 for uploads, `wrangler d1 migrations` in
place of the runtime migrator, a DNS-free SSRF guard (resolve through
`cloudflare:sockets` or drop the check), and lazy imports for the parsers. That
is a multi-day refactor, not a config change.

## Path C: Cloudflare Tunnel (free, works today)

Keep Conduit on your machine and give it a public HTTPS URL. No code changes.

```bash
# 1. Build and start the app (standalone server, same as the Docker image runs)
npm run build
node .next/standalone/server.js        # http://localhost:3000

# 2. In a second terminal, expose it
cloudflared tunnel --url http://localhost:3000
```

The quick tunnel prints a `https://<random>.trycloudflare.com` URL that anyone can
open. For a stable hostname, log in once and create a named tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create conduit
cloudflared tunnel route dns conduit conduit.example.com
cloudflared tunnel run --url http://localhost:3000 conduit
```

Set `NEXT_PUBLIC_APP_URL` to the public URL so share links and absolute URLs point
at the right host. The machine has to stay on: the tunnel dies with it.

## Path B: Cloudflare Containers (paid Workers plan)

The repository already builds a standalone image, so this path needs no
application changes:

1. `Dockerfile` builds the app, copies `.next/standalone`, and starts
   `node server.js`. It also deletes any traced `data/` and `.env` so the image
   never carries local content.
2. Add a `wrangler.jsonc` with a container and the public route:
   ```jsonc
   {
     "name": "shit", // must match the Worker name in your Cloudflare account
     "main": "src/container-worker.ts",
     "compatibility_date": "2026-01-01",
     "containers": [{ "class_name": "ConduitContainer", "image": "./Dockerfile" }],
     "durable_objects": { "bindings": [{ "class_name": "ConduitContainer", "name": "CONDUIT" }] },
     "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ConduitContainer"] }]
   }
   ```
3. `npx wrangler containers build` then `npx wrangler deploy` pushes the image to
   `registry.cloudflare.com` and routes traffic to it.

Two limits to plan for. Container disks are ephemeral: a restart or redeploy
starts from a clean filesystem, so SQLite (`SQLITE_PATH`) and
`data/uploads` (`UPLOADS_DIR`) reset unless you move them to R2 or D1. And the
plan floor is the paid Workers tier, since containers bill for CPU and memory
time.

The image itself is verified locally: `node .next/standalone/server.js` with a
scratch database passed the attachment suite (12/12), the artifact suite (17/17)
and the privacy suite (48/48), including PDF, DOCX and XLSX extraction in the
standalone layout.

## Path A: Workers + D1 + R2 (free tier, needs the refactor)

Once the async refactor above exists, the deploy is:

```bash
npm install                  # @opennextjs/cloudflare and wrangler are devDeps
npm run cf:build             # writes .open-next/worker.js
npm run cf:dry-run           # bundle report, no account needed
npx wrangler d1 create conduit && npx wrangler d1 migrations apply conduit
npx wrangler r2 bucket create conduit-uploads
npm run cf:deploy            # build, then deploy
```

The adapter and wrangler are pinned in `devDependencies`, and the pin matters.
`@opennextjs/cloudflare@1.20.10` declares a peer of `wrangler@^4.148.0`, a
version that is not published, so `npm install` fails with `ERESOLVE` whatever
wrangler you happen to have. 1.20.9 declares `wrangler@^4.125.0`, resolves
against the published 4.147.0, and still accepts `next >=16.3.8 <17`, which
covers this app on 16.4.0. Move both together, and check the adapter's wrangler
peer range is actually published before bumping.

## Before you deploy anywhere

```bash
npm run typecheck
npm run lint
npm run build
npm run files:check       # with the app and mock provider running
npm run artifacts:check
npm run privacy:check
npm run coding:check
npm run cf:dry-run        # OpenNext build plus a Cloudflare bundle report; no account needed
```

Set at least `ENCRYPTION_KEY` and `NEXT_PUBLIC_APP_URL` in the target
environment. `ENCRYPTION_KEY` is required before any provider key can be saved,
and it is never copied into a build artifact on purpose.

## What changed to make the artifact safe

`next.config.ts` now sets `outputFileTracingExcludes` for `./data/**`, the check
scripts, the docs and the build-time config files. File tracing follows
`path.resolve(process.cwd(), ...)` in
`lib/db/index.ts` and the upload helpers, so before this rule the standalone
output copied the whole project, including the SQLite database and every
uploaded attachment.

Two things the trace cannot fix on its own: Next copies `.env` into
`.next/standalone` itself, and a Docker build takes whatever `.dockerignore`
allows. The `Dockerfile` therefore deletes `./data`, `./.env` and the build
cache before the image is sealed. If you ship the standalone folder without
Docker, delete `.next/standalone/.env` first, or you ship your `ENCRYPTION_KEY`
with it. `UPLOADS_DIR` lets a container keep attachment bytes on the same
volume as the database (`/data` in `docker-compose.yml`).