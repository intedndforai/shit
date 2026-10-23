import {
  contentTypeFor,
  findSiteFile,
  injectPreviewBootstrap,
  parseSiteBundle,
  previewCsp,
} from "@/lib/sites/bundle";
import { getArtifact } from "@/lib/server/artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function notFound(message: string): Response {
  const safeMessage = escapeHtml(message);
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>404</title>
<body style="font-family:ui-monospace,Menlo,monospace;padding:2rem;line-height:1.6">
<h1 style="font-size:1.1rem">404 - ${safeMessage}</h1>
<p style="color:#666">This file is not part of the generated bundle. Check the path, or ask the model to add it.</p>
</body>`,
    {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    }
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; path?: string[] }> }
) {
  const { id, path } = await params;

  const artifact = getArtifact(id);
  if (!artifact) return notFound("That artifact no longer exists.");
  if (artifact.type !== "site") {
    return new Response("This artifact is not a multi-file site.", { status: 415 });
  }

  let bundle;
  try {
    bundle = parseSiteBundle(artifact.content);
  } catch {
    return notFound("The bundle could not be parsed.");
  }

  const requested = (path ?? []).join("/");
  const file = findSiteFile(bundle, requested);
  if (!file) return notFound(`No file at "${requested || "/"}"`);

  const isMarkup = /\.html?$/i.test(file.path);
  const headers: Record<string, string> = {
    "content-type": contentTypeFor(file.path),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": previewCsp(),
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
  };

  return new Response(isMarkup ? injectPreviewBootstrap(file.content) : file.content, {
    status: 200,
    headers,
  });
}
