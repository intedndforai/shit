import { z } from "zod";
import { jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { createProject, listProjects } from "@/lib/server/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(20000).nullable().optional(),
});

/** GET /api/projects -- every project with its file and chat counts. */
export async function GET() {
  try {
    return jsonOk({ projects: listProjects() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    const project = createProject(parsed.data);
    return jsonOk({ project }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}