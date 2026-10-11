import { z } from "zod";
import { jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { createStyle, listStyles } from "@/lib/server/styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  instructions: z.string().trim().max(4000),
  slug: z.string().max(40).optional(),
});

export async function GET() {
  try {
    return jsonOk({ styles: listStyles() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    return jsonOk({ style: createStyle(parsed.data) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}