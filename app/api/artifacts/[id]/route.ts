import { jsonError, jsonOk, errorResponse } from "@/lib/server/api";
import { artifactVersions, getArtifact } from "@/lib/server/artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/artifacts/{id} — one artifact plus every stored version. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const artifact = getArtifact(id);
    if (!artifact) return jsonError("Artifact not found.", 404);
    return jsonOk({ artifact, versions: artifactVersions(artifact.chatId, artifact.identifier) });
  } catch (error) {
    return errorResponse(error);
  }
}