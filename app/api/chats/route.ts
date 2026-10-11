import { z } from "zod";
import { jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { createChat, listChats } from "@/lib/server/chats";
import { getDefaultModel } from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonOk({ chats: listChats() });
  } catch (error) {
    return errorResponse(error);
  }
}

const createSchema = z.object({
  title: z.string().trim().max(120).nullable().optional(),
  providerId: z.string().nullable().optional(),
  modelId: z.string().nullable().optional(),
  systemPrompt: z.string().max(20000).nullable().optional(),
  projectId: z.string().nullable().optional(),
  styleId: z.string().nullable().optional(),
  incognito: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = await parseJson(request, createSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const defaultModel = parsed.data.modelId ? undefined : getDefaultModel();
    const chat = createChat({
      title: parsed.data.title ?? null,
      providerId: parsed.data.providerId ?? defaultModel?.providerId ?? null,
      modelId: parsed.data.modelId ?? defaultModel?.id ?? null,
      systemPrompt: parsed.data.systemPrompt ?? null,
      projectId: parsed.data.projectId ?? null,
      styleId: parsed.data.styleId ?? null,
      incognito: parsed.data.incognito ?? false,
    });
    return jsonOk({ chat }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}