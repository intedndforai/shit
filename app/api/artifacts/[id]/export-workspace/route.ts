import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { jsonError, jsonOk, errorResponse } from "@/lib/server/api";
import { getArtifact } from "@/lib/server/artifacts";
import { parseSiteBundle } from "@/lib/sites/bundle";
import {
  resolveTarget,
  workspaceRoot,
  workspaceStatus,
  writeWorkspaceFile,
  WorkspaceError,
} from "@/lib/tools/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  target: z.string().max(512).optional(),
  overwrite: z.boolean().optional(),
});

/** Single-file artifact types, with the file extension they are written as. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  html: "html",
  svg: "svg",
  markdown: "md",
  react: "tsx",
  code: "txt",
};

function rootRelative(absolute: string): string {
  return path.relative(workspaceRoot(), absolute).split(path.sep).join("/");
}

type BodyResult =
  | { ok: true; data: z.infer<typeof bodySchema> }
  | { ok: false; response: Response };

/** The body is optional, so an empty one is just the defaults. */
async function readBody(request: Request): Promise<BodyResult> {
  const raw = await request.text().catch(() => "");
  if (!raw.trim()) return { ok: true, data: {} };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, response: jsonError("Request body must be valid JSON.", 400) };
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    return { ok: false, response: jsonError(message, 422) };
  }
  return { ok: true, data: parsed.data };
}

/**
 * POST /api/artifacts/{id}/export-workspace - save an artifact into the local
 * workspace folder configured for the coding tools.
 *
 * A `site` artifact writes every file of its bundle under `target` (default:
 * the artifact identifier); the single-file types write one file with the
 * extension that belongs to their type. Every destination goes through the
 * coding tools' guard (`resolveTarget` / `writeWorkspaceFile`), so the secret
 * deny-list and root confinement apply and nothing outside the workspace root
 * can be written. If a destination already exists and `overwrite` is not true,
 * nothing is written and the conflicting paths come back as 409.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await readBody(request);
    if (!body.ok) return body.response;

    const artifact = getArtifact(id);
    if (!artifact) return jsonError("Artifact not found.", 404);

    // What to write, by artifact type.
    let files: Array<{ relative: string; content: string }> = [];
    if (artifact.type === "site") {
      try {
        files = parseSiteBundle(artifact.content).files.map((file) => ({
          relative: file.path,
          content: file.content,
        }));
      } catch (error) {
        return jsonError(
          error instanceof Error ? error.message : "The site bundle could not be parsed.",
          400
        );
      }
    } else if (artifact.type in EXTENSION_BY_TYPE) {
      const extension = EXTENSION_BY_TYPE[artifact.type];
      files = [
        { relative: `${artifact.identifier}.${extension}`, content: artifact.content },
      ];
    } else {
      return jsonError(`A ${artifact.type} artifact cannot be saved to the workspace.`, 415);
    }

    if (!files.length) return jsonError("The site bundle has no files to save.", 400);

    // Where it goes: workspace root + target, resolved by the same guard the
    // coding tools use, so an escape attempt is a 400 before anything else.
    const target = body.data.target?.trim() || artifact.identifier;
    const destination = resolveTarget(target);
    const planned = files.map((file) => ({
      ...file,
      absolute: resolveTarget(path.join(target, file.relative)),
    }));

    const status = workspaceStatus();
    if (!status.enabled) {
      return jsonError(
        "The coding workspace is switched off. Turn it on in Settings, Tools.",
        409
      );
    }
    if (!status.exists) {
      return jsonError(`The workspace folder does not exist: ${status.root}`, 409);
    }

    const overwrite = body.data.overwrite === true;
    const conflicts = overwrite
      ? []
      : planned
          .filter((file) => fs.existsSync(file.absolute))
          .map((file) => rootRelative(file.absolute));
    if (conflicts.length) {
      return jsonError(
        `These files already exist in the workspace: ${conflicts.join(", ")}. ` +
          'Re-run with "overwrite": true to replace them.',
        409,
        { conflicts }
      );
    }

    const written = planned.map((file) => {
      const result = writeWorkspaceFile({
        path: rootRelative(file.absolute),
        content: file.content,
      });
      return { path: result.path, bytes: result.bytes };
    });

    return jsonOk({ written, target: rootRelative(destination) });
  } catch (error) {
    if (error instanceof WorkspaceError) return jsonError(error.message, 400);
    return errorResponse(error);
  }
}
