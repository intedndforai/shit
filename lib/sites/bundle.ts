/**
 * Multi-file site bundles.
 *
 * A `site` artifact is not one file — it is a small project: markup, styles,
 * scripts, and often several pages. The model publishes it with explicit file
 * delimiters inside the artifact body:
 *
 *   <site-file path="index.html">…</site-file>
 *   <site-file path="styles.css">…</site-file>
 *   <site-file path="app.js">…</site-file>
 *
 * Files are kept in memory as a map and served from a real URL by the preview
 * route, so relative links, `<link>` stylesheets, ES modules, images and
 * multi-page navigation all work the way they would on a real host — while the
 * iframe's sandbox keeps the whole thing on an opaque origin with all network
 * egress blocked.
 *
 * A single-file bundle (no `<site-file>` tags) is accepted too and treated as
 * `index.html`, so a model that forgets the delimiters still produces something
 * previewable.
 */

export interface SiteFile {
  path: string;
  content: string;
}

export interface SiteBundle {
  /** Path of the page served at the site root. */
  entry: string;
  files: SiteFile[];
  /** Total UTF-8 size of all files. */
  bytes: number;
}

const FILE_BLOCK = /<(site-file|file|site)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

export class SiteBundleError extends Error {}

/** UTF-8 byte length, in a form that works in the browser and on the server. */
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function attribute(source: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(source);
  if (match) return match[1];
  const loose = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(source);
  return loose ? loose[1] : null;
}

/**
 * Normalise a bundle-relative path. Returns null for anything that could
 * escape the bundle (absolute paths, `..`, drive letters, NUL bytes).
 */
export function normalizeSitePath(input: string): string | null {
  const raw = (input ?? "").trim().replace(/\\/g, "/");
  if (!raw || raw.includes("\0")) return null;
  if (raw.startsWith("/") || /^[a-zA-Z]:/.test(raw) || raw.startsWith("~")) return null;
  const parts: string[] = [];
  for (const segment of raw.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (!parts.length) return null;
  // Defence in depth: consumers resolve against a declared allowlist, so this
  // is not the only control — a leading dotted component is still refused.
  if (parts[0].startsWith("..")) return null;
  return parts.join("/");
}

/** Strip one wrapping markdown fence, which models add even when told not to. */
function stripOuterFence(body: string): string {
  const trimmed = body.replace(/^\s*\n/, "").replace(/\s+$/, "");
  const fence = /^```[\w.+-]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return fence ? fence[1] : trimmed;
}

/**
 * Remove the indentation every non-empty line shares.
 *
 * The publishing format indents file contents under the `<site-file>` tag, so
 * a file parsed straight out of a published bundle carries that indent and
 * would be written to the user's disk with it. Browsers tolerate the leading
 * spaces; a file on disk should start at column 0. Only the common leading
 * spaces come off, blank lines are left as they are, and no trailing-newline
 * handling happens here — that stays with the fence strip.
 */
function dedent(body: string): string {
  const lines = body.split("\n");
  let common = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue; // a blank line carries no indentation to compare
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (indent < common) common = indent;
  }
  if (!Number.isFinite(common) || common === 0) return body;
  return lines.map((line) => (line.trim() ? line.slice(common) : line)).join("\n");
}

function guessPathFromIndex(index: number, attributes: string): string {
  const named =
    attribute(attributes, "path") ?? attribute(attributes, "name") ?? attribute(attributes, "file");
  const normalized = named ? normalizeSitePath(named) : null;
  if (normalized) return normalized;
  return index === 0 ? "index.html" : `file-${index + 1}.html`;
}

export function parseSiteBundle(content: string): SiteBundle {
  const files: SiteFile[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(FILE_BLOCK)) {
    const [, , attributes, body] = match;
    const path = guessPathFromIndex(files.length, attributes);
    const clean = dedent(stripOuterFence(body));
    // A repeated path means the model revised the file in place; last wins.
    if (seen.has(path)) {
      const existing = files.find((file) => file.path === path);
      if (existing) existing.content = clean;
      continue;
    }
    seen.add(path);
    files.push({ path, content: clean });
  }

  if (!files.length) {
    const single = dedent(stripOuterFence(content));
    if (!single.trim()) throw new SiteBundleError("The site bundle is empty.");
    files.push({ path: "index.html", content: single });
  }

  const bundle: SiteBundle = {
    entry: resolveEntry(files),
    files,
    bytes: files.reduce((total, file) => total + utf8Bytes(file.content), 0),
  };
  return bundle;
}

/** Serialise a bundle back into the `<site-file>` format. */
export function serializeSiteBundle(bundle: SiteBundle): string {
  return bundle.files
    .map((file) => `<site-file path="${file.path}">\n${file.content}\n</site-file>`)
    .join("\n\n");
}

function resolveEntry(files: readonly SiteFile[]): string {
  const index = files.find((file) => file.path.toLowerCase() === "index.html");
  if (index) return index.path;
  const rootIndex = files.find((file) => /^index\.html?$/i.test(file.path));
  if (rootIndex) return rootIndex.path;
  const anyHtml = files.find((file) => /\.html?$/i.test(file.path));
  return anyHtml?.path ?? files[0].path;
}

/**
 * Look up a request path in the bundle.
 *
 * `/` and `index.html` resolve to the entry page; a bare path with no extension
 * also tries `.html`. Anything not present returns null, which the route turns
 * into a real 404 so the page shows a broken link the way it would in
 * production.
 */
export function findSiteFile(bundle: SiteBundle, requestPath: string): SiteFile | null {
  const clean = requestPath.replace(/^\/+/, "");
  if (!clean || clean === ".")
    return bundle.files.find((file) => file.path === bundle.entry) ?? null;

  const normalized = normalizeSitePath(clean);
  if (normalized === null) return null;

  const candidates = [
    normalized,
    normalized.endsWith("/") ? `${normalized}index.html` : `${normalized}/index.html`,
    /\.[\w]+$/.test(normalized) ? null : `${normalized}.html`,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const found = bundle.files.find((file) => file.path === candidate);
    if (found) return found;
  }
  return null;
}

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  wasm: "application/wasm",
  csv: "text/csv; charset=utf-8",
};

export function contentTypeFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "text/plain; charset=utf-8";
}

export interface SiteSummary {
  pages: string[];
  stylesheets: string[];
  scripts: string[];
  assets: string[];
  bytes: number;
}

/** What the UI shows in the file list without parsing every file's markup. */
export function summarizeSite(bundle: SiteBundle): SiteSummary {
  const pages: string[] = [];
  const stylesheets: string[] = [];
  const scripts: string[] = [];
  const assets: string[] = [];
  for (const file of bundle.files) {
    if (/\.html?$/i.test(file.path)) pages.push(file.path);
    else if (/\.css$/i.test(file.path)) stylesheets.push(file.path);
    else if (/\.[cm]?js$/i.test(file.path)) scripts.push(file.path);
    else assets.push(file.path);
  }
  return { pages, stylesheets, scripts, assets, bytes: bundle.bytes };
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Flatten a bundle into one self-contained HTML document, for the single-file
 * export. Stylesheets and classic scripts are inlined; ES-module scripts with
 * relative imports cannot be flattened safely and are left as a comment so the
 * export never silently produces a broken page.
 */
export function inlineSite(bundle: SiteBundle, entryPath?: string): string {
  const entry = bundle.files.find((file) => file.path === (entryPath ?? bundle.entry));
  if (!entry) throw new SiteBundleError(`No such page in the bundle: ${entryPath ?? bundle.entry}`);

  const lookup = (reference: string, pagePath: string): SiteFile | null => {
    const base = pagePath.includes("/") ? pagePath.slice(0, pagePath.lastIndexOf("/") + 1) : "";
    const combined = normalizeSitePath(base + reference.replace(/^\/+/, ""));
    if (!combined) return null;
    return bundle.files.find((file) => file.path === combined) ?? null;
  };

  let html = entry.content;

  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = attribute(tag, "href");
    if (!href || /^(?:https?:)?\/\//i.test(href) || href.startsWith("data:")) return tag;
    const file = lookup(href, entry.path);
    if (!file) return `<!-- stylesheet not found: ${escapeAttribute(href)} -->`;
    return `<style data-from="${escapeAttribute(file.path)}">\n${file.content}\n</style>`;
  });

  html = html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (tag, attributes: string, body: string) => {
      if (!attributes || !/\bsrc\s*=/i.test(attributes)) return tag;
      const src = attribute(attributes, "src");
      if (!src || /^(?:https?:)?\/\//i.test(src) || src.startsWith("data:")) return tag;
      const file = lookup(src, entry.path);
      if (!file) return `<!-- script not found: ${escapeAttribute(src)} -->`;
      if (/\btype\s*=\s*["']?module/i.test(attributes)) {
        return `<!-- module script inlined as a classic script; relative imports are not flattened -->\n<script>\n${file.content}\n</script>`;
      }
      const isDeferred = /\bdefer\b/i.test(attributes);
      const stripped = body.trim() ? `\n${body.trim()}\n` : "";
      return `<script${isDeferred ? "" : " data-inserted"}>\n${file.content}${stripped}</script>`;
    }
  );

  return html;
}

/* ------------------------------------------------------------------ */
/* Preview runtime                                                     */
/* ------------------------------------------------------------------ */

/**
 * The CSP every previewed page is served with.
 *
 * `default-src 'self'` is what makes a multi-file bundle work — the page can
 * fetch its own sibling stylesheets, scripts, images and fonts. Every other
 * capability is denied, most importantly `connect-src 'none'`, so a generated
 * page can never call back into Conduit's own API or anywhere else on the
 * network. The `sandbox` directive re-states the iframe's restrictions on the
 * document itself, so the two cannot drift apart.
 */
export function previewCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-scripts allow-forms allow-modals allow-popups",
  ].join("; ");
}

/**
 * The console shim injected into every previewed HTML page.
 *
 * A generated page's failures are the most useful signal the user has, and a
 * sandboxed frame hides them. This forwards runtime errors, unhandled
 * rejections and `console.error` / `console.warn` to the parent as structured
 * messages, and announces the title once loaded so the previewer can label the
 * tab. It never sends anything to a model on its own.
 */
export function previewBootstrap(): string {
  return `<script data-conduit-preview>
(function () {
  var send = function (kind, payload) {
    try {
      parent.postMessage({ source: "conduit-preview", kind: kind, payload: payload }, "*");
    } catch (e) { /* nothing else we can do inside the sandbox */ }
  };
  var text = function (value) {
    if (value instanceof Error) return value.message || String(value);
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  };
  var cap = function (value) { return String(value).slice(0, 600); };

  window.addEventListener("error", function (event) {
    send("error", cap((event && event.message) || "Script error"));
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    send("error", cap("Unhandled rejection: " + text(reason)));
  });
  ["error", "warn"].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      var parts = Array.prototype.slice.call(arguments).map(text);
      send("console", { level: level, message: cap(parts.join(" ")) });
      return original.apply(console, arguments);
    };
  });
  document.addEventListener("DOMContentLoaded", function () {
    send("ready", { title: cap(document.title || "") });
  });
})();
</script>`;
}

/** Insert the preview runtime as the first thing inside `<head>`. */
export function injectPreviewBootstrap(html: string): string {
  const runtime = previewBootstrap();
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}\n${runtime}${html.slice(at)}`;
  }
  const doctype = /<!doctype\b[^>]*>/i.exec(html);
  if (doctype) {
    const at = doctype.index + doctype[0].length;
    return `${html.slice(0, at)}\n<head>${runtime}</head>${html.slice(at)}`;
  }
  return `<head>${runtime}</head>\n${html}`;
}
