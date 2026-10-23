import { reviewCraft } from "@/lib/craft/slop";
import { parseSiteBundle } from "@/lib/sites/bundle";
import { jsonError, jsonOk, errorResponse } from "@/lib/server/api";
import { getArtifact } from "@/lib/server/artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The detector is a set of regex passes over stored content, so unbounded input is a DoS bound.
const MAX_REVIEW_BYTES = 2_000_000;

// More files than this cannot be reviewed in a request, and past it the review is unrepresentative.
const MAX_REVIEW_FILES = 64;

/**
 * POST /api/artifacts/{id}/review — run the slop detector over an artifact.
 *
 * Returns the findings, a 0-100 score and a revision brief. Nothing is sent to
 * a model: the user decides whether to act on the brief, and the UI offers to
 * put it in the composer. An optional `direction` in the body pins the art
 * direction the brief should ask for on the revision.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const artifact = getArtifact(id);
    if (!artifact) return jsonError("Artifact not found.", 404);

    const files =
      artifact.type === "site"
        ? (() => {
            try {
              return parseSiteBundle(artifact.content).files;
            } catch {
              return [{ path: "index.html", content: artifact.content }];
            }
          })()
        : [
            {
              path:
                artifact.type === "html" ? "index.html" : `${artifact.identifier}.${artifact.type}`,
              content: artifact.content,
            },
          ];

    const capped = files.slice(0, MAX_REVIEW_FILES);
    const bytes = capped.reduce((total, file) => total + Buffer.byteLength(file.content, "utf8"), 0);
    if (bytes > MAX_REVIEW_BYTES) {
      return jsonError(
        `Artifact is ${bytes.toLocaleString()} bytes, which exceeds the ${MAX_REVIEW_BYTES.toLocaleString()}-byte review limit.`,
        413
      );
    }

    const review = reviewCraft(capped);
    return jsonOk({
      review,
      artifact: { id: artifact.id, identifier: artifact.identifier, type: artifact.type },
    });
  } catch (error) {
    return errorResponse(error);
  }
}