import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { responseStyles } from "@/lib/db/schema";

/**
 * Response styles: a slug, a name, and the instructions appended to the system
 * prompt. Four built-ins are seeded on first use so a chat can always pick one.
 */

export interface StyleDto {
  id: string;
  name: string;
  slug: string;
  instructions: string;
  builtin: boolean;
}

export const BUILTIN_STYLES: Array<{ slug: string; name: string; instructions: string }> = [
  { slug: "normal", name: "Normal", instructions: "" },
  {
    slug: "concise",
    name: "Concise",
    instructions: "Answer in as few words as the question allows. Prefer short paragraphs or tight bullets. Skip preamble and recap.",
  },
  {
    slug: "explanatory",
    name: "Explanatory",
    instructions:
      "Explain the reasoning, define terms the first time you use them, and add a short example or analogy where it helps. Still be direct.",
  },
  {
    slug: "formal",
    name: "Formal",
    instructions: "Use a formal, professional register. No contractions, no slang, no exclamation marks. Address the reader as a colleague.",
  },
];

const BUILTIN_SLUGS = new Set(BUILTIN_STYLES.map((style) => style.slug));

/** Built-ins live in the database so a chat can reference them by id. */
export function ensureBuiltinStyles(): void {
  const db = getDb();
  for (const style of BUILTIN_STYLES) {
    const existing = db.select().from(responseStyles).where(eq(responseStyles.slug, style.slug)).limit(1).get();
    if (!existing) {
      db.insert(responseStyles).values(style).run();
    } else if (existing.name !== style.name || existing.instructions !== style.instructions) {
      db.update(responseStyles).set({ name: style.name, instructions: style.instructions }).where(eq(responseStyles.id, existing.id)).run();
    }
  }
}

export function listStyles(): StyleDto[] {
  ensureBuiltinStyles();
  return getDb()
    .select()
    .from(responseStyles)
    .orderBy(asc(responseStyles.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      instructions: row.instructions,
      builtin: BUILTIN_SLUGS.has(row.slug),
    }));
}

export function styleInstructions(styleId: string | null | undefined): string | null {
  if (!styleId) return null;
  ensureBuiltinStyles();
  const row = getDb().select().from(responseStyles).where(eq(responseStyles.id, styleId)).limit(1).get();
  return row?.instructions?.trim() ? row.instructions.trim() : null;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || `style-${Date.now().toString(36)}`;
}

export function createStyle(input: { name: string; instructions: string; slug?: string }): StyleDto {
  ensureBuiltinStyles();
  const db = getDb();
  let slug = input.slug ? slugify(input.slug) : slugify(input.name);
  if (BUILTIN_SLUGS.has(slug) || db.select().from(responseStyles).where(eq(responseStyles.slug, slug)).limit(1).get()) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }
  const row = db
    .insert(responseStyles)
    .values({ name: input.name, slug, instructions: input.instructions })
    .returning()
    .get();
  return { id: row.id, name: row.name, slug: row.slug, instructions: row.instructions, builtin: false };
}

export function updateStyle(id: string, patch: { name?: string; instructions?: string }): StyleDto | null {
  const row = getDb().update(responseStyles).set(patch).where(eq(responseStyles.id, id)).returning().get();
  if (!row) return null;
  return { id: row.id, name: row.name, slug: row.slug, instructions: row.instructions, builtin: BUILTIN_SLUGS.has(row.slug) };
}

export function deleteStyle(id: string): { ok: boolean; reason?: string } {
  const db = getDb();
  const row = db.select().from(responseStyles).where(eq(responseStyles.id, id)).limit(1).get();
  if (!row) return { ok: false, reason: "Style not found." };
  if (BUILTIN_SLUGS.has(row.slug)) return { ok: false, reason: "Built-in styles cannot be deleted." };
  db.delete(responseStyles).where(eq(responseStyles.id, id)).run();
  return { ok: true };
}
/**
 * Turns a writing sample into style instructions using the user's own model.
 * Returns null when no provider is configured, so the caller can fall back to
 * asking the user to write the instructions by hand.
 */
export async function deriveStyleInstructions(sample: string): Promise<string | null> {
  const trimmed = sample.trim();
  if (trimmed.length < 40) return null;

  const { getAdapter } = await import("@/lib/providers");
  const { connectionFromProvider, defaultProviderRow, getDefaultModel } = await import("@/lib/server/providers");
  const provider = defaultProviderRow();
  const model = getDefaultModel();
  if (!provider || !model) return null;

  const adapter = getAdapter(provider.apiFormat as never);
  let instructions = "";
  try {
    for await (const event of adapter.stream({
      ...connectionFromProvider(provider),
      model: model.externalId,
      system:
        "You describe writing styles. Given a sample, reply with 3-5 short imperative instructions " +
        "(max 60 words total) that would make an assistant write in that style. No preamble, no quotes.",
      messages: [{ role: "user", content: [{ kind: "text", text: trimmed.slice(0, 4000) }] }],
      maxTokens: 220,
      temperature: 0.3,
    })) {
      if (event.type === "text_delta") instructions += event.text;
    }
  } catch {
    return null;
  }

  const clean = instructions.replace(/\s+/g, " ").trim();
  return clean.length >= 20 ? clean.slice(0, 1000) : null;
}