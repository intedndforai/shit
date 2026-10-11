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

export const ARTIFACT_TYPES = ["html", "react", "svg", "mermaid", "markdown", "code"] as const;
export type ArtifactKind = (typeof ARTIFACT_TYPES)[number];

export interface ParsedArtifact {
  identifier: string;
  type: ArtifactKind;
  title: string | null;
  content: string;
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

    found.push({
      identifier,
      type: normaliseType(attribute(attributes, "type")),
      title: attribute(attributes, "title"),
      content,
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