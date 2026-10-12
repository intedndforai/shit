#!/usr/bin/env node
/**
 * Expose the local Conduit server through a free Cloudflare quick tunnel.
 *
 *   npm start        # in one terminal   (http://localhost:3000)
 *   npm run tunnel   # in another
 *
 * A quick tunnel needs no Cloudflare account and no login: cloudflared asks the
 * edge for a random https://<name>.trycloudflare.com hostname and proxies it to
 * the local port. The URL lives only while this process and the machine stay
 * up, so this is the "on the internet for free" path for an app that keeps
 * SQLite and uploads on local disk.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const port = process.env.PORT ?? "3000";
const target = process.env.TUNNEL_URL ?? `http://localhost:${port}`;

function findBinary() {
  if (process.env.CLOUDFLARED) return process.env.CLOUDFLARED;
  const name = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const local = path.join(process.cwd(), ".tools", name);
  return existsSync(local) ? local : "cloudflared";
}

const binary = findBinary();
console.log(`Starting a Cloudflare quick tunnel to ${target}`);
console.log(`Using cloudflared at: ${binary}\n`);

const child = spawn(binary, ["tunnel", "--url", target, "--no-autoupdate"], {
  stdio: ["ignore", "pipe", "pipe"],
});

let announced = false;
const onData = (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(text);
  if (match && !announced) {
    announced = true;
    console.log(`\n=== Public URL: ${match[0]} ===\n`);
  }
};

child.stdout.on("data", onData);
child.stderr.on("data", onData);

child.on("error", (error) => {
  console.error(`Could not run cloudflared (${binary}).`);
  console.error(
    "Download it from https://github.com/cloudflare/cloudflared/releases, put the binary in .tools/, or set CLOUDFLARED."
  );
  console.error(error.message);
  process.exit(1);
});

child.on("exit", (code) => process.exit(code ?? 0));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}