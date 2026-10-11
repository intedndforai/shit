import { jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { createProvider, listProviders, providerInputSchema } from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List providers (keys masked, never returned). */
export async function GET() {
  try {
    return jsonOk({ providers: listProviders() });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Create a provider; the key is encrypted before it touches disk. */
export async function POST(request: Request) {
  const parsed = await parseJson(request, providerInputSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const provider = createProvider(parsed.data);
    return jsonOk({ provider }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}