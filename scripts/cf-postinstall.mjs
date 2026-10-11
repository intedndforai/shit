// Cloudflare Workers Builds safety net.
//
// `npx wrangler deploy` inspects the project root. When it finds a Next.js
// config, an OpenNext config and this adapter installed, it assumes the project
// is already compiled and forwards to `opennextjs-cloudflare deploy`. That
// command only packages `.open-next/`; it never builds anything, so a Worker
// whose dashboard has no build step dies with:
//
//   ERROR Could not find compiled Open Next config, did you run the build command?
//
// Workers Builds runs `npm ci` before the deploy command, so this hook builds
// the OpenNext output when nothing else has. It stays a no-op outside
// Cloudflare, on Windows, and whenever a build already ran.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const compiledConfig = join(".open-next", ".build", "opennext.config.edge.mjs");

if (!process.env.WORKERS_CI) {
  // Local installs, Docker builds, and other CI providers build explicitly.
  process.exit(0);
}

if (existsSync(compiledConfig)) {
  console.log("[cf] OpenNext build already present, nothing to do");
  process.exit(0);
}

if (process.platform === "win32") {
  console.log(
    "[cf] Skipping the OpenNext build: recreating symlinks needs Developer Mode on Windows"
  );
  process.exit(0);
}

const localBin = join("node_modules", ".bin", "opennextjs-cloudflare");
const command = existsSync(localBin) ? localBin : "npx";
const args = existsSync(localBin) ? ["build"] : ["--yes", "opennextjs-cloudflare@1.20.9", "build"];

console.log("[cf] No build produced .open-next, so building it now for the deploy step");

const result = spawnSync(command, args, { stdio: "inherit" });

if (result.error) {
  console.error(`[cf] Could not start the OpenNext build (${command}): ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    "[cf] The OpenNext build failed, see the output above. The deploy cannot package a missing build."
  );
  process.exit(result.status ?? 1);
}

console.log("[cf] OpenNext build finished, the deploy step has something to package");
