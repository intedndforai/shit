import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { savedPrompts } from "@/lib/db/schema";

/**
 * Slash commands: built-ins plus the user's own saved prompts. Selecting one in
 * the composer inserts its body (with `{text}` replaced by whatever the user
 * already typed).
 */

export interface PromptDto {
  id: string;
  name: string;
  command: string;
  content: string;
  builtin: boolean;
}

export const BUILTIN_PROMPTS: Array<{ command: string; name: string; content: string }> = [
  {
    command: "summarize",
    name: "Summarize",
    content: "Summarize the following clearly, keeping the facts and numbers that matter:\n\n{text}",
  },
  {
    command: "translate",
    name: "Translate",
    content: "Translate the following into English. Keep names and technical terms as they are, then add a one-line note about tone:\n\n{text}",
  },
  {
    command: "explain",
    name: "Explain simply",
    content: "Explain the following as if teaching a curious beginner. Define each term, then give a concrete example:\n\n{text}",
  },
  {
    command: "improve",
    name: "Improve writing",
    content:
      "Rewrite the following so it is clearer and tighter. Keep the meaning and the author's voice, and list the three biggest changes you made:\n\n{text}",
  },
  {
    command: "plan",
    name: "Plan steps",
    content: "Turn the following goal into an ordered plan with concrete steps, each with a check for done:\n\n{text}",
  },
];

const BUILTIN_COMMANDS = new Set(BUILTIN_PROMPTS.map((prompt) => prompt.command));

/** Built-ins are seeded so the composer can always resolve their ids. */
export function ensureBuiltinPrompts(): void {
  const db = getDb();
  for (const prompt of BUILTIN_PROMPTS) {
    const existing = db.select().from(savedPrompts).where(eq(savedPrompts.command, prompt.command)).limit(1).get();
    if (!existing) db.insert(savedPrompts).values(prompt).run();
    else if (existing.name !== prompt.name || existing.content !== prompt.content) {
      db.update(savedPrompts).set({ name: prompt.name, content: prompt.content }).where(eq(savedPrompts.id, existing.id)).run();
    }
  }
}

export function listPrompts(): PromptDto[] {
  ensureBuiltinPrompts();
  return getDb()
    .select()
    .from(savedPrompts)
    .orderBy(asc(savedPrompts.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      command: row.command,
      content: row.content,
      builtin: BUILTIN_COMMANDS.has(row.command),
    }));
}

function normaliseCommand(raw: string): string {
  return raw
    .trim()
    .replace(/^\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function createPrompt(input: { name: string; command: string; content: string }): PromptDto | { error: string } {
  ensureBuiltinPrompts();
  const db = getDb();
  const command = normaliseCommand(input.command || input.name);
  if (!command) return { error: "Give the command a name." };
  if (db.select().from(savedPrompts).where(eq(savedPrompts.command, command)).limit(1).get()) {
    return { error: `/${command} already exists.` };
  }
  const row = db
    .insert(savedPrompts)
    .values({ name: input.name.trim().slice(0, 60) || command, command, content: input.content })
    .returning()
    .get();
  return { id: row.id, name: row.name, command: row.command, content: row.content, builtin: false };
}

export function updatePrompt(id: string, patch: { name?: string; content?: string }): PromptDto | null {
  const row = getDb().update(savedPrompts).set(patch).where(eq(savedPrompts.id, id)).returning().get();
  if (!row) return null;
  return { id: row.id, name: row.name, command: row.command, content: row.content, builtin: BUILTIN_COMMANDS.has(row.command) };
}

export function deletePrompt(id: string): { ok: boolean; reason?: string } {
  const db = getDb();
  const row = db.select().from(savedPrompts).where(eq(savedPrompts.id, id)).limit(1).get();
  if (!row) return { ok: false, reason: "Prompt not found." };
  if (BUILTIN_COMMANDS.has(row.command)) return { ok: false, reason: "Built-in commands cannot be deleted." };
  db.delete(savedPrompts).where(eq(savedPrompts.id, id)).run();
  return { ok: true };
}

/** Fills `{text}` (or appends) with the composer's current content. */
export function applyPrompt(content: string, text: string): string {
  const trimmed = text.trim();
  if (content.includes("{text}")) return content.replace(/\{text\}/g, trimmed);
  return trimmed ? `${content}\n\n${trimmed}` : content;
}