import { contentTypeFor, injectPreviewBootstrap, previewCsp } from "@/lib/sites/bundle";
import { readWorkspaceBytes, workspaceStatus } from "@/lib/tools/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/preview/{...path} — serve a file out of the workspace so
 * the code workspace can preview a real site.
 *
 * Every path is relative to the workspace root, which is exactly what makes a
 * multi-file project work: a page at `site/index.html` that links
 * `styles.css` resolves to `/api/workspace/preview/site/styles.css`, and
 * `../shared/reset.css` resolves correctly too. ES modules, images and fonts all
 * follow the same rule.
 *
 * The bytes are read through `readWorkspaceBytes`, so the same guards the model
 * faces apply: nothing outside the root, and secret-looking names return a plain
 * 404 rather than confirming they exist. HTML is served with the preview runtime
 * injected and the same restrictive CSP the artifact previewer uses, so a page
 * under preview can never call back into the app.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const status = workspaceStatus();
  if (!status.enabled) {
    return new Response("The coding workspace is switched off.", { status: 409 });
  }

  const requested = (path ?? []).join("/");
  const bytes = readWorkspaceBytes({ path: requested });
  if (!bytes) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>404</title>
<body style="font-family:ui-monospace,Menlo,monospace;padding:2rem;line-height:1.6">
<h1 style="font-size:1.1rem">404 — ${escape(requested || "/")}</h1>
<p style="color:#666">Not readable from the workspace (missing, outside the root, or a secret-looking name).</p>
</body>`,
      {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      }
    );
  }

  const isMarkup = /\.html?$/i.test(requested);
  const body = isMarkup ? injectPreviewBootstrap(bytes.toString("utf8")) : new Uint8Array(bytes);

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentTypeFor(requested),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": previewCsp(),
      // These bytes are the user's own local files, so cross-origin reads are refused:
      // no wildcard origin and no cross-origin resource sharing. Nothing here needs one —
      // generated sites use system fonts, and a same-origin sandboxed iframe can still load
      // its own same-origin subresources.
      "access-control-allow-origin": "same-origin",
      "cross-origin-resource-policy": "same-origin",
    },
  });
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
