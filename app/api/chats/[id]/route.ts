import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import { chatPatchSchema, deleteChat, getChat, listMessages, updateChat } from "@/lib/server/chats";
import { findModel, getProvider } from "@/lib/server/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const chat = getChat(id);
    if (!chat) return jsonError("Chat not found.", 404);

    const stored = listMessages(id);
    const model = chat.modelId ? findModel(chat.modelId) : undefined;
    const provider = chat.providerId ? getProvider(chat.providerId) : undefined;
    const providerPublic = provider
      ? { id: provider.id, name: provider.name, apiFormat: provider.apiFormat }
      : null;

    return jsonOk({
      chat: {
        ...chat,
        createdAt: chat.createdAt.getTime(),
        updatedAt: chat.updatedAt.getTime(),
      },
      model: model ? { id: model.id, externalId: model.externalId, displayName: model.displayName } : null,
      provider: providerPublic,
      messages: stored.map((row) => ({
        ...row,
        createdAt: row.createdAt.getTime(),
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
    return jsonOk({ chat });
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