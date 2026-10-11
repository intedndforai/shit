import dns from "node:dns/promises";
import net from "node:net";
import { readToolsConfig } from "./web-search";

/**
 * SSRF-guarded web fetch for the `fetch_url` tool.
 *
 * Only http/https is allowed, the host must resolve to a public address (no
 * loopback, private, link-local, or unique-local ranges), redirects are followed
 * a bounded number of times, and the body is capped before being converted to
 * plain text.
 */

const MAX_BYTES = 1_000_000;
const MAX_CHARS = 20_000;
const MAX_REDIRECTS = 3;

export class FetchError extends Error {}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.startsWith("fe80")) return true;
  if (value.startsWith("::ffff:")) return isPrivateIpv4(value.replace("::ffff:", ""));
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(hostname)) {
    throw new FetchError("That host is not reachable from Conduit (local addresses are blocked).");
  }

  const literal = net.isIP(hostname);
  if (literal === 4 && isPrivateIpv4(hostname)) {
    throw new FetchError("Private and loopback addresses are blocked.");
  }
  if (literal === 6 && isPrivateIpv6(hostname)) {
    throw new FetchError("Private and loopback addresses are blocked.");
  }
  if (literal) return;

  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new FetchError(`Could not resolve ${hostname}.`);
  }

  for (const record of records) {
    const bad = record.family === 4 ? isPrivateIpv4(record.address) : isPrivateIpv6(record.address);
    if (bad) throw new FetchError("That host resolves to a private address, which is blocked.");
  }
}

/** Crude but predictable HTML → text conversion (no DOM in a route handler). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  text: string;
  truncated: boolean;
}

export async function fetchUrl(input: string): Promise<FetchedPage> {
  if (!readToolsConfig().fetch.enabled) {
    throw new FetchError("Fetching URLs is turned off in Settings → Tools.");
  }

  let current = input.trim();
  if (!/^https?:\/\//i.test(current)) current = `https://${current}`;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = new URL(current);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new FetchError("Only http and https URLs can be fetched.");
    }
    await assertPublicHost(url.hostname);

    const response = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": "Conduit/0.1 (+https://github.com/)", accept: "text/html,text/plain,*/*" },
      signal: AbortSignal.timeout(12_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new FetchError(`The server redirected without a location (${response.status}).`);
      current = new URL(location, url).toString();
      continue;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const buffer = Buffer.from(await response.arrayBuffer());
    const truncatedBySize = buffer.byteLength > MAX_BYTES;
    const raw = buffer.subarray(0, MAX_BYTES).toString("utf8");
    const text = contentType.includes("html") ? htmlToText(raw) : raw.trim();

    return {
      url: url.toString(),
      status: response.status,
      contentType: contentType.split(";")[0] || "text/plain",
      text: text.slice(0, MAX_CHARS),
      truncated: truncatedBySize || text.length > MAX_CHARS,
    };
  }

  throw new FetchError("Too many redirects.");
}