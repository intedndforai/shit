import { asc, desc, eq } from "drizzle-orm";
import { getAdapter, contentToText } from "@/lib/providers";
import { connectionFromProvider, defaultProviderRow, getDefaultModel } from "@/lib/server/providers";
import { getActivePath } from "@/lib/server/branches";
import { getDb } from "@/lib/db";
import { models, providers, type Provider } from "@/lib/db/schema";

/**
 * Chat titles come from a small, cheap completion. Point this at a dedicated
 * "title model" provider in Settings; otherwise the default provider is used.
 */
function titleProvider(): Provider | undefined {
  return (
    getDb().select().from(providers).where(eq(providers.isTitleModel, true)).limit(1).get() ??
    defaultProviderRow()
  );
}

function titleModelId(providerId: string): string {
  return (
    getDb()
      .select()
      .from(models)
      .where(eq(models.providerId, providerId))
      .orderBy(desc(models.isDefault), asc(models.createdAt))
      .limit(1)
      .get()?.externalId ??
    getDefaultModel()?.externalId ??
    "gpt-4o-mini"
  );
}

export async function generateTitle(chatId: string, currentTitle: string | null): Promise<string | null> {
  const path = getActivePath(chatId);
  const firstUser = path.find((message) => message.role === "user");
  if (!firstUser) return null;

  const provider = titleProvider();
  if (!provider) return null;

  const userText = contentToText(firstUser.content).slice(0, 1500);
  const assistant = path.find((message) => message.role === "assistant" && contentToText(message.content));

  const adapter = getAdapter(provider.apiFormat as never);
  const connection = connectionFromProvider(provider);

  let title = "";
  try {
    for await (const event of adapter.stream({
      ...connection,
      model: titleModelId(provider.id),
      system:
        "You write chat titles. Reply with a title of at most 6 words. No quotes, no trailing punctuation, no explanation.",
      messages: [
        {
          role: "user",
          content: [
            {
              kind: "text",
              text: `User asked:\n${userText}\n\nAssistant replied:\n${
                assistant ? contentToText(assistant.content).slice(0, 800) : "(no reply yet)"
              }\n\nTitle:`,
            },
          ],
        },
      ],
      maxTokens: 24,
      temperature: 0.2,
    })) {
      if (event.type === "text_delta") title += event.text;
    }
  } catch {
    return null;
  }

  const clean = title
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split("\n")[0]
    .replace(/[.,:;]+$/, "");

  if (!clean || clean.toLowerCase() === (currentTitle ?? "").toLowerCase()) return null;
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
}