import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { models, providers, type Model, type Provider } from "@/lib/db/schema";
import { deleteSetting, getSetting, setSetting } from "@/lib/server/settings";

/**
 * Model roles: the optional jobs that can run on their own model — chat titles,
 * context summaries, and embeddings for project retrieval. The choice is stored
 * as a model id in app settings and mirrors the provider-level flag that this
 * app used before roles were configurable, so both paths keep working.
 */

export const modelRoles = ["title", "summarization", "embeddings"] as const;
export type ModelRole = (typeof modelRoles)[number];

const SETTING_KEY: Record<ModelRole, string> = {
  title: "roles.title.modelId",
  summarization: "roles.summarization.modelId",
  embeddings: "roles.embeddings.modelId",
};

export type RoleAssignments = Record<ModelRole, string | null>;

function providerPatch(role: ModelRole, value: boolean) {
  switch (role) {
    case "title":
      return { isTitleModel: value };
    case "summarization":
      return { isSummarizationModel: value };
    case "embeddings":
      return { isEmbeddingsModel: value };
  }
}

function providerFlag(role: ModelRole) {
  switch (role) {
    case "title":
      return providers.isTitleModel;
    case "summarization":
      return providers.isSummarizationModel;
    case "embeddings":
      return providers.isEmbeddingsModel;
  }
}

/** The first model of a provider, preferring the one flagged as the default. */
function firstModelOf(providerId: string): Model | undefined {
  return getDb()
    .select()
    .from(models)
    .where(eq(models.providerId, providerId))
    .orderBy(desc(models.isDefault), asc(models.createdAt))
    .limit(1)
    .get();
}

export function roleAssignments(): RoleAssignments {
  return {
    title: getSetting<string>(SETTING_KEY.title) ?? null,
    summarization: getSetting<string>(SETTING_KEY.summarization) ?? null,
    embeddings: getSetting<string>(SETTING_KEY.embeddings) ?? null,
  };
}

/** Points a role at a model (or clears it with null). */
export function setRole(role: ModelRole, modelId: string | null): RoleAssignments {
  const db = getDb();

  if (!modelId) {
    // Clearing a role removes the row: app_settings.value is NOT NULL, so a
    // JSON null would be rejected by SQLite.
    deleteSetting(SETTING_KEY[role]);
    db.update(providers).set(providerPatch(role, false)).run();
    return roleAssignments();
  }

  const model = db.select().from(models).where(eq(models.id, modelId)).limit(1).get();
  if (!model) throw new Error("That model no longer exists.");

  setSetting(SETTING_KEY[role], model.id);
  db.update(providers).set(providerPatch(role, false)).run();
  db.update(providers)
    .set(providerPatch(role, true))
    .where(eq(providers.id, model.providerId))
    .run();

  return roleAssignments();
}

/**
 * The model and provider serving a role. Falls back to the provider-level flag
 * from earlier milestones, then to nothing at all.
 */
export function assignedRole(role: ModelRole): { model: Model; provider: Provider } | null {
  const db = getDb();
  const modelId = getSetting<string>(SETTING_KEY[role]);
  if (modelId) {
    const model = db.select().from(models).where(eq(models.id, modelId)).limit(1).get();
    const provider = model
      ? db.select().from(providers).where(eq(providers.id, model.providerId)).limit(1).get()
      : undefined;
    if (model && provider) return { model, provider };
  }

  const provider = db.select().from(providers).where(eq(providerFlag(role), true)).limit(1).get();
  if (!provider) return null;
  const model = firstModelOf(provider.id);
  return model ? { model, provider } : null;
}