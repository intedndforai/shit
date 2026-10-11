import { z } from "zod";
import { jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { appendMessage, createChat } from "@/lib/server/chats";
import { getDefaultModel } from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contentPartSchema = z.object({
  kind: z.enum(["text", "image", "document", "thinking", "tool_use", "tool_result"]).or(z.string()),
  text: z.string().optional(),
  dataUrl: z.string().optional(),
  url: z.string().optional(),
  name: z.string().optional(),
  mime: z.string().optional(),
  output: z.string().optional(),
  id: z.string().optional(),
});

const importSchema = z.object({
  version: z.number().optional(),
  chat: z.object({
    title: z.string().nullable().optional(),
    systemPrompt: z.string().nullable().optional(),
    temperature: z.number().optional(),
    topP: z.number().optional(),
    maxTokens: z.number().optional(),
  }),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant", "tool"]),
      content: z.array(contentPartSchema).default([]),
    })
  ),
});

/** POST /api/chats/import — restore a chat exported as JSON. */
export async function POST(request: Request) {
  const parsed = await parseJson(request, importSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const defaultModel = getDefaultModel();
    const chat = createChat({
      title: parsed.data.chat.title ?? "Imported chat",
      systemPrompt: parsed.data.chat.systemPrompt ?? null,
      providerId: defaultModel?.providerId ?? null,
      modelId: defaultModel?.id ?? null,
    });

    let parentId: string | null = null;
    for (const message of parsed.data.messages) {
      const row = appendMessage({
        chatId: chat.id,
        role: message.role,
        content: message.content.map((part) => {
          if (part.kind === "text") return { kind: "text" as const, text: part.text ?? "" };
          if (part.kind === "image")
            return { kind: "image" as const, dataUrl: part.dataUrl, url: part.url };
          if (part.kind === "thinking") return { kind: "thinking" as const, text: part.text ?? "" };
          if (part.kind === "tool_result")
            return { kind: "tool_result" as const, id: part.id ?? "tool", output: part.output ?? "" };
          if (part.kind === "tool_use")
            return {
              kind: "tool_use" as const,
              id: part.id ?? "tool",
              name: part.name ?? "tool",
              input: {},
            };
          return {
            kind: "document" as const,
            name: part.name ?? "document",
            mime: part.mime ?? "text/plain",
            text: part.text,
          };
        }),
        parentId,
      });
      parentId = row.id;
    }

    return jsonOk({ chatId: chat.id, imported: parsed.data.messages.length }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}