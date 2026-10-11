import { NextResponse } from "next/server";
import { jsonError, errorResponse } from "@/lib/server/api";
import { getChat } from "@/lib/server/chats";
import { getActivePath } from "@/lib/server/branches";
import { findModel, getProvider } from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "chat";
}

/** GET /api/chats/{id}/export?format=md|json */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const chat = getChat(id);
    if (!chat) return jsonError("Chat not found.", 404);

    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "md").toLowerCase();
    const path = getActivePath(id);
    const model = chat.modelId ? findModel(chat.modelId) : undefined;
    const provider = chat.providerId ? getProvider(chat.providerId) : undefined;
    const name = slugify(chat.title ?? "chat");

    if (format === "json") {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        chat: {
          title: chat.title,
          systemPrompt: chat.systemPrompt,
          temperature: chat.temperature,
          topP: chat.topP,
          maxTokens: chat.maxTokens,
          model: model?.externalId ?? null,
          provider: provider?.name ?? null,
        },
        messages: path.map((message) => ({
          role: message.role,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
          model: message.modelId ? findModel(message.modelId)?.externalId ?? null : null,
          tokenUsage: message.tokenUsage,
          cost: message.cost,
        })),
      };

      return new NextResponse(JSON.stringify(payload, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${name}.json"`,
        },
      });
    }

    const lines: string[] = [];
    lines.push(`# ${chat.title ?? "Untitled chat"}`, "");
    lines.push(`_Exported from Conduit on ${new Date().toISOString()}_`, "");
    if (provider || model) lines.push(`Model: ${model?.externalId ?? "unknown"} (${provider?.name ?? "unknown"})`, "");
    if (chat.systemPrompt) lines.push("## System prompt", "", chat.systemPrompt, "");
    lines.push("---", "");

    for (const message of path) {
      const label = message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : message.role;
      lines.push(`## ${label}`, "");
      for (const part of message.content ?? []) {
        if (part.kind === "text") lines.push(part.text, "");
        else if (part.kind === "thinking") lines.push("<details><summary>Thinking</summary>", "", part.text, "", "</details>", "");
        else if (part.kind === "document") lines.push(`_Attachment: ${part.name}_`, "", part.text ?? "", "");
        else if (part.kind === "image") lines.push("_Image attachment_", "");
      }
      lines.push("");
    }

    return new NextResponse(lines.join("\n"), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${name}.md"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}