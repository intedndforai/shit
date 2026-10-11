import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { chatPatchSchema, deleteChat, getChat, updateChat } from "@/lib/server/chats";
import { getActivePath } from "@/lib/server/branches";
import { findModel, fallbackModelFor, getProvider } from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const chat = getChat(id);
    if (!chat) return jsonError("Chat not found.", 404);

    const model = chat.modelId ? findModel(chat.modelId) : undefined;
    const provider = chat.providerId ? getProvider(chat.providerId) : undefined;
    const path = getActivePath(id);

    return jsonOk({
      chat: {
        id: chat.id,
        title: chat.title,
        titleSource: chat.titleSource,
        systemPrompt: chat.systemPrompt,
        providerId: chat.providerId,
        modelId: chat.modelId,
        temperature: chat.temperature,
        topP: chat.topP,
        maxTokens: chat.maxTokens,
        thinkingBudget: chat.thinkingBudget,
        toolsEnabled: chat.toolsEnabled ?? null,
        pinned: chat.pinned,
        archived: chat.archived,
        activeLeafId: chat.activeLeafId,
        createdAt: chat.createdAt.getTime(),
        updatedAt: chat.updatedAt.getTime(),
      },
      model: model
        ? {
            id: model.id,
            externalId: model.externalId,
            displayName: model.displayName,
            contextWindow: model.contextWindow,
            maxOutputTokens: model.maxOutputTokens,
            pricePerMillionInput: model.pricePerMillionInput,
            pricePerMillionOutput: model.pricePerMillionOutput,
            reasoningCapable: Boolean(model.capabilities?.reasoning),
            fallbackId: fallbackModelFor(model)?.id ?? null,
          }
        : null,
      provider: provider ? { id: provider.id, name: provider.name, apiFormat: provider.apiFormat } : null,
      messages: path.map((message) => ({
        id: message.id,
        chatId: message.chatId,
        role: message.role,
        content: message.content,
        parentId: message.parentId,
        branchIndex: message.branchIndex,
        siblingIndex: message.siblingIndex,
        siblingCount: message.siblingCount,
        modelId: message.modelId,
        tokenUsage: message.tokenUsage,
        cost: message.cost,
        error: message.error,
        createdAt: message.createdAt.getTime(),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJson(request, chatPatchSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const chat = updateChat(id, parsed.data);
    if (!chat) return jsonError("Chat not found.", 404);
    return jsonOk({ chat: { ...chat, createdAt: chat.createdAt.getTime(), updatedAt: chat.updatedAt.getTime() } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const removed = deleteChat(id);
    if (!removed) return jsonError("Chat not found.", 404);
    return jsonOk({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}