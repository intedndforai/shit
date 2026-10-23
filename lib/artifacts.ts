/**
 * Artifact parsing, shared by the server (which persists versions) and the
 * client (which strips the raw tags out of the transcript).
 *
 * The shape of an artifact block is:
 *
 *   <artifact identifier="chart" type="html" title="Quarterly chart">
 *     ...content...
 *   </artifact>
 */

import { inlineSite, parseSiteBundle } from "@/lib/sites/bundle";

export const ARTIFACT_TYPES = ["html", "site", "react", "svg", "mermaid", "markdown", "code"] as const;
export type ArtifactKind = (typeof ARTIFACT_TYPES)[number];

export interface ParsedArtifact {
  identifier: string;
  type: ArtifactKind;
  title: string | null;
  content: string;
  /** The paths emitted by a `<site-file>` bundle, in order (empty otherwise). */
  files: string[];
}

/** Any `<site-file>` tag means the block is a multi-file site, whatever it claims. */
export const SITE_FILE_DELIMITER = /<site-file\b/i;

const SITE_FILE_PATH = /<site-file\b[^>]*\bpath\s*=\s*["']([^"']+)["'][^>]*>/gi;

/** The file paths a site bundle declares, in the order they appear. */
export function siteFilePaths(content: string): string[] {
  const paths: string[] = [];
  for (const match of content.matchAll(SITE_FILE_PATH)) {
    paths.push(match[1]);
  }
  return paths;
}

const ARTIFACT_PATTERN = /<artifact\b([^>]*)>([\s\S]*?)<\/artifact>/gi;

function attribute(source: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(source);
  return match ? match[1] : null;
}

function normaliseType(raw: string | null): ArtifactKind {
  const value = (raw ?? "").toLowerCase().trim();
  if ((ARTIFACT_TYPES as readonly string[]).includes(value)) return value as ArtifactKind;
  if (value === "javascript" || value === "js" || value === "jsx") return "react";
  if (value === "html5") return "html";
  if (value === "text" || value === "plaintext") return "code";
  return "code";
}

export function parseArtifacts(text: string): ParsedArtifact[] {
  const found: ParsedArtifact[] = [];

  for (const match of text.matchAll(ARTIFACT_PATTERN)) {
    const [, attributes, body] = match;
    const content = body.replace(/^\n/, "").replace(/\s+$/, "");
    if (!content.trim()) continue;

    const identifier =
      attribute(attributes, "identifier") ??
      attribute(attributes, "id") ??
      attribute(attributes, "title") ??
      `artifact-${found.length + 1}`;

    // A block that carries `<site-file>` is a site bundle even if it declared
    // itself as html, so the multi-file previewer is the one that runs.
    const declared = normaliseType(attribute(attributes, "type"));
    const files = siteFilePaths(content);
    const type: ArtifactKind = SITE_FILE_DELIMITER.test(content) ? "site" : declared;

    found.push({
      identifier,
      type,
      title: attribute(attributes, "title"),
      content,
      files,
    });
  }

  return found;
}

/** Strip artifact blocks so the transcript does not double-render them. */
export function stripArtifacts(text: string): string {
  return text
    .replace(ARTIFACT_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A single self-contained HTML file with no remote references, for download.
 * HTML and SVG artifacts keep their markup; every other type is escaped into a
 * monospace document so the exported file is still readable.
 */
export function toStandaloneHtml(artifact: {
  identifier: string;
  type: ArtifactKind;
  title: string | null;
  content: string;
}): string {
  const title = escapeHtml(artifact.title ?? artifact.identifier);

  let inline: string;
  if (artifact.type === "site") {
    // Flatten the bundle to its entry page. A parse failure (an empty or
    // malformed bundle) falls back to the raw source rather than a blank file.
    try {
      inline = inlineSite(parseSiteBundle(artifact.content));
    } catch {
      inline = `<pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(
        artifact.content
      )}</pre>`;
    }
  } else if (artifact.type === "html" || artifact.type === "svg") {
    inline = artifact.content;
  } else {
    inline = `<pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(
      artifact.content
    )}</pre>`;
  }

  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>" + title + "</title>",
    "  </head>",
    "  <body>",
    inline,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}
