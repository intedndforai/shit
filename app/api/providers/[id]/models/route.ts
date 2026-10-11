import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { connectionFromProvider, getProvider, listStoredModels, syncModels } from "@/lib/server/providers";
import { getAdapter } from "@/lib/providers";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Saved models for this provider. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return jsonOk({ models: listStoredModels(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

const discoverSchema = z.object({ discover: z.literal(true) }).optional();

/** Fetch the live model list from `GET {baseUrl}/models` and save it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await parseJson(request, discoverSchema);

  const provider = getProvider(id);
  if (!provider) return jsonError("Provider not found.", 404);

  try {
    const adapter = getAdapter(provider.apiFormat as never);
    const discovered = await adapter.listModels(connectionFromProvider(provider));
    const saved = syncModels(id, discovered);
    return jsonOk({ models: saved });
  } catch (error) {
    return errorResponse(error);
  }
}