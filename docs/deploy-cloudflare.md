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
     "name": "conduit",
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
npm install --save-dev @opennextjs/cloudflare@^1.20.10 wrangler@^4.148.0
npx opennextjs-cloudflare build          # writes .open-next/worker.js
npx wrangler deploy --dry-run            # bundle report, no account needed
npx wrangler d1 create conduit && npx wrangler d1 migrations apply conduit
npx wrangler r2 bucket create conduit-uploads
npx wrangler deploy
```

`@opennextjs/cloudflare` 1.20.x accepts `next >=16.3.8 <17`, and this app is on
Next 16.4.0, so the adapter version is not the blocker. Note the `wrangler` on
this machine is 4.147.0, one patch below the adapter's peer range; use
`npx wrangler@latest` or upgrade the global install first.

## Before you deploy anywhere

```bash
npm run typecheck
npm run lint
npm run build
npm run files:check       # with the app and mock provider running
npm run artifacts:check
npm run privacy:check
npm run coding:check
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