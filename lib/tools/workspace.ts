import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createTwoFilesPatch } from "diff";
import { readToolsConfig, type CodingConfig } from "./web-search";

/**
 * Workspace tools for the coding agent.
 *
 * Everything here runs on the machine that hosts Conduit, so the module keeps
 * three promises: a path can never leave the configured root (including through
 * a symlink), obvious secret files are refused outright, and mutating calls only
 * happen after the chat route has collected the user's approval.
 */

export class WorkspaceError extends Error {}

export const CODING_TOOL_NAMES = [
  "list_files",
  "read_file",
  "write_file",
  "edit_file",
  "search_files",
  "run_command",
] as const;

export function isCodingTool(name: string): boolean {
  return (CODING_TOOL_NAMES as readonly string[]).includes(name);
}

const MAX_ENTRIES = 400;
const MAX_SEARCH_FILES = 600;
const MAX_SEARCH_MATCHES = 80;
const MAX_SEARCH_BYTES = 6 * 1024 * 1024;
const MAX_DIFF_CHARS = 4_000;
const MAX_READ_LINES = 400;
const MAX_OUTPUT_CHARS = 12_000;
const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER = 4 * 1024 * 1024;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".next-build",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  "target",
]);

/** File names the agent may neither read nor write. */
const DENY_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.keystore$/i,
  /\.jks$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^_netrc$/i,
  /^credentials(\.json|\.yml|\.yaml)?$/i,
  /\.sqlite3?$/i,
  /\.db(-wal|-shm|-journal)?$/i,
];

export interface WorkspaceStatus {
  enabled: boolean;
  root: string;
  exists: boolean;
  allowCommands: boolean;
  autoApproveWrites: boolean;
}

function codingConfig(): CodingConfig {
  return readToolsConfig().coding;
}

/** The folder the coding tools may touch: `WORKSPACE_ROOT` beats the setting. */
export function workspaceRoot(): string {
  const override = process.env.WORKSPACE_ROOT?.trim();
  const configured = override || codingConfig().root?.trim() || "workspace";
  return path.resolve(process.cwd(), configured);
}

export function workspaceStatus(): WorkspaceStatus {
  const config = codingConfig();
  const root = workspaceRoot();
  return {
    enabled: config.enabled,
    root,
    exists: fs.existsSync(root),
    allowCommands: config.allowCommands,
    autoApproveWrites: config.autoApproveWrites,
  };
}

function requireEnabled(): CodingConfig {
  const config = codingConfig();
  if (!config.enabled) {
    throw new WorkspaceError("The coding workspace is switched off. Turn it on in Settings, Tools.");
  }
  return config;
}

function relativeToRoot(absolute: string): string {
  return path.relative(workspaceRoot(), absolute).split(path.sep).join("/");
}

/** Why this file is off limits, or null when it is fine to touch. */
function denyReason(absolute: string): string | null {
  const segments = relativeToRoot(absolute).split("/");
  if (segments.includes(".git") || segments.includes(".ssh")) {
    return "Git and SSH metadata are off limits to the workspace tools.";
  }
  const base = segments[segments.length - 1] ?? "";
  if (DENY_PATTERNS.some((pattern) => pattern.test(base))) {
    return "That file name looks like a secret, so the workspace tools refuse to touch it.";
  }
  return null;
}

/** Normalise a model-supplied path and refuse anything with an escape in it. */
function cleanRelative(input: string): string {
  const raw = (input ?? "").trim().replace(/\\/g, "/");
  if (!raw || raw === "." || raw === "./") return "";
  if (raw.includes("\0")) throw new WorkspaceError("That path contains a NUL byte.");
  if (/^[a-zA-Z]:/.test(raw) || raw.startsWith("/") || raw.startsWith("~")) {
    throw new WorkspaceError("Use a path relative to the workspace root, not an absolute one.");
  }
  const parts: string[] = [];
  for (const segment of raw.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) throw new WorkspaceError("That path points outside the workspace.");
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

function assertNoSymlinkEscape(target: string): void {
  const root = workspaceRoot();
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return;
  }
  let probe = target;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return;
    probe = parent;
  }
  let realProbe: string;
  try {
    realProbe = fs.realpathSync(probe);
  } catch {
    return;
  }
  const inside = path.relative(realRoot, realProbe);
  if (inside && (inside.startsWith("..") || path.isAbsolute(inside))) {
    throw new WorkspaceError("That path resolves outside the workspace through a link.");
  }
}

/** Resolve a relative path inside the workspace, or throw. */
export function resolveTarget(input: string): string {
  const root = path.resolve(workspaceRoot());
  const relative = cleanRelative(input);
  const target = relative ? path.resolve(root, relative) : root;
  const inside = path.relative(root, target);
  if (inside && (inside.startsWith("..") || path.isAbsolute(inside))) {
    throw new WorkspaceError("That path points outside the workspace.");
  }
  assertNoSymlinkEscape(target);
  return target;
}

/** Same as `resolveTarget`, and additionally refuses secrets. */
function guardFile(input: string): string {
  const target = resolveTarget(input);
  const reason = denyReason(target);
  if (reason) throw new WorkspaceError(reason);
  return target;
}

function shapeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clampOutput(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated]` : text;
}

function clampDiff(diff: string): string {
  return diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n…[diff truncated]` : diff;
}

function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8000);
  for (let index = 0; index < limit; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

function diffFor(relative: string, before: string, after: string): string {
  const patch = createTwoFilesPatch(
    relative,
    relative,
    before,
    after,
    "before",
    "after",
    { context: 3 }
  );
  return clampDiff(patch);
}

export function listFiles(input: { path?: string; depth?: number } = {}): string {
  requireEnabled();
  const start = resolveTarget(input.path ?? "");
  if (!fs.existsSync(start)) {
    throw new WorkspaceError("That folder does not exist in the workspace yet.");
  }
  if (!fs.statSync(start).isDirectory()) {
    throw new WorkspaceError("list_files takes a folder. Use read_file for a single file.");
  }
  const depth = Math.min(Math.max(Math.trunc(Number(input.depth ?? 2)) || 2, 1), 6);
  const root = workspaceRoot();
  const lines: string[] = [];
  let truncated = false;

  const walk = (dir: string, level: number) => {
    if (lines.length >= MAX_ENTRIES) {
      truncated = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    for (const entry of entries) {
      if (lines.length >= MAX_ENTRIES) {
        truncated = true;
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      if (denyReason(full)) continue;
      const relative = relativeToRoot(full);
      const indent = "  ".repeat(level - 1);
      if (entry.isDirectory()) {
        lines.push(`${indent}${relative}/`);
        if (level < depth) walk(full, level + 1);
      } else if (entry.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          size = 0;
        }
        lines.push(`${indent}${relative} (${shapeLabel(size)})`);
      }
    }
  };

  walk(start, 1);
  const header = `Workspace root: ${root}\nListing: ${relativeToRoot(start) || "."} (depth ${depth})`;
  const body = lines.length ? lines.join("\n") : "(empty folder)";
  return clampOutput(`${header}\n\n${body}${truncated ? "\n…[more entries not shown]" : ""}`);
}

export function readFile(input: { path: string; startLine?: number; endLine?: number }): string {
  const config = requireEnabled();
  const target = guardFile(input.path ?? "");
  if (!fs.existsSync(target)) throw new WorkspaceError("That file does not exist in the workspace.");
  const stats = fs.statSync(target);
  if (stats.isDirectory()) throw new WorkspaceError("That path is a folder. Use list_files instead.");
  const limit = Math.max(4_000, Math.min(config.maxReadBytes || 200_000, 1_000_000));
  if (stats.size > limit) {
    throw new WorkspaceError(
      `That file is ${shapeLabel(stats.size)}; the read limit is ${shapeLabel(limit)}. Read a line range instead.`
    );
  }
  const buffer = fs.readFileSync(target);
  if (looksBinary(buffer)) throw new WorkspaceError("That file looks binary, so it was not read.");
  const allLines = buffer.toString("utf8").split(/\r?\n/);
  const start = Math.max(1, Math.trunc(Number(input.startLine ?? 1)) || 1);
  const end = Math.min(allLines.length, Math.trunc(Number(input.endLine ?? start + MAX_READ_LINES - 1)) || 0) || allLines.length;
  if (start > allLines.length) throw new WorkspaceError("That line range is past the end of the file.");
  const slice = allLines.slice(start - 1, Math.max(start, end));
  const numbered = slice.map((line, index) => `${start + index}: ${line}`).join("\n");
  const header = `${relativeToRoot(target)} (lines ${start}-${start + slice.length - 1} of ${allLines.length})`;
  return clampOutput(`${header}\n${numbered}`);
}

export function writeFile(input: { path: string; content: string }): string {
  requireEnabled();
  const target = guardFile(input.path ?? "");
  const content = typeof input.content === "string" ? input.content : "";
  const existed = fs.existsSync(target);
  const before = existed ? fs.readFileSync(target, "utf8") : "";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  const relative = relativeToRoot(target);
  const diff = diffFor(relative, before, content);
  const verb = existed ? "Updated" : "Created";
  return clampOutput(`${verb} ${relative} (${shapeLabel(Buffer.byteLength(content))}).\n\n${diff}`);
}

export function editFile(input: {
  path: string;
  find: string;
  replace: string;
  replaceAll?: boolean;
}): string {
  requireEnabled();
  const target = guardFile(input.path ?? "");
  if (!fs.existsSync(target)) throw new WorkspaceError("That file does not exist in the workspace.");
  const find = typeof input.find === "string" ? input.find : "";
  const replace = typeof input.replace === "string" ? input.replace : "";
  if (!find) throw new WorkspaceError("edit_file needs the exact text to replace in `find`.");
  const before = fs.readFileSync(target, "utf8");
  const occurrences = before.split(find).length - 1;
  if (!occurrences) {
    throw new WorkspaceError("That text is not in the file. Read it again and copy the snippet exactly.");
  }
  if (occurrences > 1 && !input.replaceAll) {
    throw new WorkspaceError(
      `That snippet appears ${occurrences} times. Pass a longer snippet, or replaceAll: true to change every copy.`
    );
  }
  const after = input.replaceAll ? before.split(find).join(replace) : before.replace(find, replace);
  fs.writeFileSync(target, after, "utf8");
  const relative = relativeToRoot(target);
  return clampOutput(
    `Edited ${relative} (${occurrences} replacement${occurrences === 1 ? "" : "s"}).\n\n${diffFor(relative, before, after)}`
  );
}

export function searchFiles(input: {
  query: string;
  path?: string;
  maxResults?: number;
}): string {
  requireEnabled();
  const query = (input.query ?? "").trim();
  if (!query) throw new WorkspaceError("search_files needs a `query`.");
  const start = resolveTarget(input.path ?? "");
  if (!fs.existsSync(start)) throw new WorkspaceError("That folder does not exist in the workspace.");
  const max = Math.min(Math.max(Math.trunc(Number(input.maxResults ?? 30)) || 30, 1), MAX_SEARCH_MATCHES);

  let matcher: (line: string) => boolean;
  let literal = false;
  try {
    const expression = new RegExp(query, "i");
    matcher = (line) => expression.test(line);
  } catch {
    literal = true;
    const needle = query.toLowerCase();
    matcher = (line) => line.toLowerCase().includes(needle);
  }
  if (literal) {
    const needle = query.toLowerCase();
    matcher = (line) => line.toLowerCase().includes(needle);
  }

  const matches: string[] = [];
  let scannedFiles = 0;
  let scannedBytes = 0;
  let hitLimit = false;

  const walk = (dir: string) => {
    if (hitLimit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hitLimit) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || denyReason(full)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (scannedFiles >= MAX_SEARCH_FILES) {
        hitLimit = true;
        return;
      }
      if (denyReason(full)) continue;
      let stats: fs.Stats;
      try {
        stats = fs.statSync(full);
      } catch {
        continue;
      }
      if (stats.size > 1_000_000) continue;
      scannedFiles += 1;
      scannedBytes += stats.size;
      if (scannedBytes > MAX_SEARCH_BYTES) {
        hitLimit = true;
        return;
      }
      let buffer: Buffer;
      try {
        buffer = fs.readFileSync(full);
      } catch {
        continue;
      }
      if (looksBinary(buffer)) continue;
      const lines = buffer.toString("utf8").split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!matcher(lines[index])) continue;
        matches.push(`${relativeToRoot(full)}:${index + 1}: ${lines[index].trim().slice(0, 200)}`);
        if (matches.length >= max) {
          hitLimit = true;
          return;
        }
      }
    }
  };

  walk(start);
  if (!matches.length) {
    return `No matches for ${JSON.stringify(query)} in ${relativeToRoot(start) || "."} (${scannedFiles} file${scannedFiles === 1 ? "" : "s"} searched).`;
  }
  const suffix = hitLimit ? "\n…[more matches not shown]" : "";
  return clampOutput(`${matches.length} match${matches.length === 1 ? "" : "es"}:\n${matches.join("\n")}${suffix}`);
}

export function runCommand(input: { command: string; cwd?: string; timeoutMs?: number }): string {
  const config = requireEnabled();
  if (!config.allowCommands) {
    throw new WorkspaceError(
      "Running shell commands is off. Turn on \"Let the agent run commands\" in Settings, Tools."
    );
  }
  const command = (input.command ?? "").trim();
  if (!command) throw new WorkspaceError("run_command needs a `command`.");
  const cwd = resolveTarget(input.cwd ?? "");
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new WorkspaceError("The working directory for that command does not exist in the workspace.");
  }
  const timeout = Math.min(Math.max(Math.trunc(Number(input.timeoutMs ?? COMMAND_TIMEOUT_MS)) || COMMAND_TIMEOUT_MS, 1_000), 120_000);
  const isWindows = process.platform === "win32";
  const shell = isWindows ? process.env.COMSPEC || "cmd.exe" : "/bin/sh";
  const args = isWindows ? ["/d", "/s", "/c", command] : ["-c", command];

  const result = spawnSync(shell, args, {
    cwd,
    timeout,
    maxBuffer: COMMAND_MAX_BUFFER,
    encoding: "utf8",
    windowsHide: true,
    env: process.env,
  });

  const stdout = (result.stdout ?? "").trimEnd();
  const stderr = (result.stderr ?? "").trimEnd();
  const parts: string[] = [`$ ${command}`, `cwd: ${relativeToRoot(cwd) || "."}`];

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") {
      parts.push(`(timed out after ${Math.round(timeout / 1000)}s)`);
    } else {
      parts.push(`(failed to start: ${result.error.message})`);
    }
  }
  parts.push(`exit code: ${result.status === null ? "none" : result.status}`);
  if (stdout) parts.push(`stdout:\n${stdout}`);
  if (stderr) parts.push(`stderr:\n${stderr}`);
  if (!stdout && !stderr) parts.push("(no output)");
  return clampOutput(parts.join("\n"));
}