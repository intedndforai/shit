import { z } from "zod";
import { jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { readProfile, writeProfile } from "@/lib/server/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().max(120).optional(),
  role: z.string().max(200).optional(),
  instructions: z.string().max(4000).optional(),
});

export async function GET() {
  try {
    return jsonOk({ profile: readProfile() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    return jsonOk({ profile: writeProfile(parsed.data) });
  } catch (error) {
    return errorResponse(error);
  }
}