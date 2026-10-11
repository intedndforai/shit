import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { projectSkills, skills, type Skill, type SkillSource } from "@/lib/db/schema";

/**
 * Skills are versioned instruction packs. A row is one published version;
 * editing inserts a new row with the same skillKey and a bumped version so
 * history is never silently overwritten. Imported skills carry provenance and
 * a trust label; nothing in a skill is ever executed - instructions only enter
 * the model context when a user assigns them to a project.
 */

/* ------------------------------------------------------------------ */
/* Built-ins (spec section 13)                                         */
/* ------------------------------------------------------------------ */

const BUILTIN_SKILLS: Array<{
  name: string;
  description: string;
  taskTypes: string[];
  instructions: string;
  requiredTools: string[];
}> = [
  {
    name: "Create a web application",
    description: "Guides building a small web app end to end: plan, structure, files, run, and verify.",
    taskTypes: ["build", "web", "project"],
    instructions:
      "When creating a web app: start by clarifying the data model and the single most important user flow, then propose a file structure before writing code. Implement one feature at a time, keep functions small, and always say how to run and verify the result after each step.",
    requiredTools: ["project_write", "project_list", "project_read"],
  },
  {
    name: "Review a codebase",
    description: "Surveys a project and reports on structure, risks, and the highest-value fixes.",
    taskTypes: ["review", "code", "project"],
    instructions:
      "Review in this order: entry points and data flow, error handling, secrets and auth boundaries, type safety, and tests. Group findings by severity, quote the exact file and line for each one, and never propose a fix you did not verify against the surrounding code.",
    requiredTools: ["project_list", "project_read", "web_search"],
  },
  {
    name: "Write tests",
    description: "Designs meaningful unit and integration tests that verify behavior rather than implementation.",
    taskTypes: ["tests", "code", "project"],
    instructions:
      "Write tests that pin observable behavior: start with the public inputs and outputs, cover the failure branches and boundary values, and mock at the process edge. Prefer table-driven cases when the logic repeats. Say which command runs the suite and what the expected output is.",
    requiredTools: ["project_read", "project_write"],
  },
  {
    name: "Debug errors",
    description: "Diagnoses an error from evidence: reproduce, narrow, fix, verify.",
    taskTypes: ["debug", "code"],
    instructions:
      "Never guess from the message alone. Reproduce the failure, isolate the smallest input that triggers it, read the surrounding code, then state the root cause with evidence. Apply the smallest fix and verify the original case plus one adjacent case before declaring done.",
    requiredTools: ["project_read", "web_search"],
  },
  {
    name: "Refactor code",
    description: "Improves structure without changing behavior, with diff-first discipline.",
    taskTypes: ["refactor", "code", "project"],
    instructions:
      "Refactor in small, behavior-preserving steps. Before moving code, state what stays the same (contract, outputs, error cases). After each step, note what to re-run. Prefer deleting duplication over adding indirection, and name things by what they mean in the domain.",
    requiredTools: ["project_read", "project_write"],
  },
  {
    name: "Summarize documents",
    description: "Condenses long material into an accurate, decision-ready summary.",
    taskTypes: ["summarize", "research"],
    instructions:
      "Extract the claim, the evidence, and the open questions. Keep names, numbers, dates, and caveats exact; never add a fact that is not in the source. End with one paragraph a busy reader could act on.",
    requiredTools: ["web_fetch", "file_read"],
  },
  {
    name: "Analyze CSV or spreadsheet data",
    description: "Computes trustworthy summaries and comparisons from tabular data.",
    taskTypes: ["data", "analysis"],
    instructions:
      "Name the columns, the unit of each measure, and the row count before analyzing. Prefer simple, verifiable aggregates (counts, sums, means, distributions) over opaque models, and show the exact figures you relied on. Flag gaps, duplicates, and missing values explicitly.",
    requiredTools: ["csv_stats", "file_read"],
  },
  {
    name: "Produce a research report with citations",
    description: "Runs a plan-search-fetch-synthesize research flow with numbered sources.",
    taskTypes: ["research", "report"],
    instructions:
      "Plan search queries that cover the question's main angles, search and fetch the most authoritative pages, then synthesize with numbered citations for every factual claim. Never fabricate a source: cite only what was actually fetched, and say when a claim could not be verified.",
    requiredTools: ["web_search", "web_fetch"],
  },
  {
    name: "Create accessible UI",
    description: "Produces interfaces that meet WCAG AA: keyboard, focus, contrast, landmarks.",
    taskTypes: ["ui", "web", "accessibility"],
    instructions:
      "For every interface: a logical DOM order and real focus management, visible focus rings, contrast above 4.5:1 for text, labeled controls, live announcements for status changes, and no motion that cannot be paused. Say how you verified each requirement rather than asserting it.",
    requiredTools: ["project_write", "web_search"],
  },
  {
    name: "Review a project for common security issues",
    description: "Checks a project against a short checklist of common, concrete vulnerabilities.",
    taskTypes: ["security", "review", "project"],
    instructions:
      "Check in this order: secrets in source or logs, injection sinks, unsafe deserialization or eval, SSRF-prone fetches, authz gaps, dependency risk, and missing output escaping. For each finding give the file, the trigger, and a concrete mitigation. Distinguish confirmed issues from ones that need further inspection.",
    requiredTools: ["project_list", "project_read", "web_search"],
  },
];

/* ------------------------------------------------------------------ */
/* Provenance + trust                                                  */
/* ------------------------------------------------------------------ */

const TRUSTED_SKILL_DOMAINS = new Set([
  "github.com",
  "docs.github.com",
  "nextjs.org",
  "react.dev",
  "developer.mozilla.org",
  "nodejs.org",
  "python.org",
  "docs.python.org",
  "drizzle.team",
  "vercel.com",
  "learn.microsoft.com",
  "developer.apple.com",
]);

function hashSkillsContent(input: {
  name: string;
  description: string;
  taskTypes: string[];
  instructions: string;
  requiredTools: string[];
}): string {
  const canonical = JSON.stringify({
    name: input.name,
    description: input.description,
    taskTypes: [...input.taskTypes].sort(),
    instructions: input.instructions,
    requiredTools: [...input.requiredTools].sort(),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "skill-" + randomUUID().slice(0, 8);
}

function uniqueKey(name: string, taken: Set<string>): string {
  const base = slugify(name);
  let key = base;
  let n = 2;
  while (taken.has(key)) key = base + "-" + n++;
  return key;
}

/** Domain host including subdomain (not a suffix hack): exact host match. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function trustForProvenance(url: string | null | undefined): "trusted" | "untrusted" {
  if (!url) return "untrusted";
  const host = hostOf(url);
  return host && TRUSTED_SKILL_DOMAINS.has(host) ? "trusted" : "untrusted";
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export interface SkillDto extends Skill {
  assignedProjects: number;
}

function toDto(row: Skill, assignedCounts: Map<string, number>): SkillDto {
  return { ...row, assignedProjects: assignedCounts.get(row.skillKey) ?? 0 };
}

function latestPerKey(rows: Skill[]): Skill[] {
  const byKey = new Map<string, Skill>();
  for (const row of rows) {
    const existing = byKey.get(row.skillKey);
    if (!existing || row.version > existing.version) byKey.set(row.skillKey, row);
  }
  return [...byKey.values()];
}

function assignmentCounts(): Map<string, number> {
  const joins = getDb().select().from(projectSkills).all();
  const all = getDb().select().from(skills).all();
  const byId = new Map(all.map((s) => [s.id, s]));
  const counts = new Map<string, number>();
  for (const join of joins) {
    const skill = byId.get(join.skillId);
    if (!skill) continue;
    counts.set(skill.skillKey, (counts.get(skill.skillKey) ?? 0) + 1);
  }
  return counts;
}

export function ensureBuiltinSkills(): void {
  const db = getDb();
  for (const builtin of BUILTIN_SKILLS) {
    const key = slugify(builtin.name);
    const existing = db.select().from(skills).where(eq(skills.skillKey, key)).limit(1).get();
    if (existing) continue;
    const integrityHash = hashSkillsContent(builtin);
    db.insert(skills)
      .values({
        skillKey: key,
        version: 1,
        name: builtin.name,
        description: builtin.description,
        taskTypes: builtin.taskTypes,
        instructions: builtin.instructions,
        requiredTools: builtin.requiredTools,
        source: "builtin",
        provenance: {},
        trustStatus: "trusted",
        integrityHash,
        enabled: true,
      })
      .run();
  }
}

export function listSkills(): SkillDto[] {
  ensureBuiltinSkills();
  const rows = getDb().select().from(skills).orderBy(asc(skills.createdAt)).all();
  const counts = assignmentCounts();
  // Latest version per key, newest creation first.
  return latestPerKey(rows)
    .reverse()
    .map((row) => toDto(row, counts));
}

export function getSkill(id: string): SkillDto | undefined {
  ensureBuiltinSkills();
  const row = getDb().select().from(skills).where(eq(skills.id, id)).limit(1).get();
  if (!row) return undefined;
  return toDto(row, assignmentCounts());
}

export function listSkillVersions(skillKey: string): Skill[] {
  ensureBuiltinSkills();
  return getDb()
    .select()
    .from(skills)
    .where(eq(skills.skillKey, skillKey))
    .orderBy(desc(skills.version))
    .all();
}

export interface SkillCreateInput {
  name: string;
  description?: string;
  taskTypes?: string[];
  instructions?: string;
  requiredTools?: string[];
}

export type CreateSkillResult = { skill: SkillDto } | { error: string };

export function createSkill(input: SkillCreateInput, extra?: Partial<Pick<Skill, "source" | "provenance" | "trustStatus">>): CreateSkillResult {
  ensureBuiltinSkills();
  const db = getDb();
  const name = input.name.trim();
  if (!name) return { error: "Skill name is required." };
  const taken = new Set(db.select({ skillKey: skills.skillKey }).from(skills).all().map((r) => r.skillKey));
  const skillKey = uniqueKey(name, taken);
  const body = {
    name,
    description: input.description?.trim() ?? "",
    taskTypes: (input.taskTypes ?? []).map((t) => t.trim()).filter(Boolean),
    instructions: input.instructions?.trim() ?? "",
    requiredTools: (input.requiredTools ?? []).map((t) => t.trim()).filter(Boolean),
  };
  const integrityHash = hashSkillsContent(body);
  const row = db
    .insert(skills)
    .values({
      skillKey,
      version: 1,
      ...body,
      integrityHash,
      source: extra?.source ?? "user",
      provenance: extra?.provenance ?? {},
      trustStatus: extra?.trustStatus ?? (extra?.source === "imported" ? trustForProvenance(extra?.provenance?.url) : "trusted"),
      enabled: true,
    })
    .returning()
    .get();
  return { skill: toDto(row, assignmentCounts()) };
}

export interface SkillPatch {
  name?: string;
  description?: string;
  taskTypes?: string[];
  instructions?: string;
  requiredTools?: string[];
  enabled?: boolean;
  trustStatus?: "trusted" | "untrusted" | "reviewed";
  provenance?: { url?: string | null; retrievedAt?: number | null; contentHash?: string | null } | null;
}

export type UpdateSkillResult = { skill: SkillDto; versionBumped?: boolean } | { error: string };

export function updateSkill(id: string, patch: SkillPatch): UpdateSkillResult {
  ensureBuiltinSkills();
  const db = getDb();
  const row = db.select().from(skills).where(eq(skills.id, id)).limit(1).get();
  if (!row) return { error: "Skill not found." };

  // Only the latest version may be edited; older versions are read-only history.
  const latest = db.select().from(skills).where(eq(skills.skillKey, row.skillKey)).orderBy(desc(skills.version)).limit(1).get();
  if (!latest || latest.id !== row.id) return { error: "Only the latest version of a skill can be edited. Restore that version first." };

  const contentKeys = ["name", "description", "taskTypes", "instructions", "requiredTools"] as const;
  const changed = contentKeys.some((key) => patch[key] !== undefined);
  const next: Partial<Skill> = {};

  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.trustStatus !== undefined) next.trustStatus = patch.trustStatus;
  if (patch.provenance !== undefined) next.provenance = patch.provenance ?? {};

  if (changed) {
    const body = {
      name: (patch.name ?? row.name).trim(),
      description: (patch.description ?? row.description ?? "").trim(),
      taskTypes: (patch.taskTypes ?? row.taskTypes ?? []).map((t) => t.trim()).filter(Boolean),
      instructions: (patch.instructions ?? row.instructions ?? "").trim(),
      requiredTools: (patch.requiredTools ?? row.requiredTools ?? []).map((t) => t.trim()).filter(Boolean),
    };
    const integrityHash = hashSkillsContent(body);
    const inserted = db
      .insert(skills)
      .values({
        skillKey: row.skillKey,
        version: latest.version + 1,
        ...body,
        integrityHash,
        source: row.source,
        provenance: row.provenance ?? {},
        trustStatus: row.trustStatus,
        enabled: patch.enabled ?? row.enabled,
      })
      .returning()
      .get();
    return { skill: toDto(inserted, assignmentCounts()), versionBumped: true };
  }

  if (Object.keys(next).length) {
    db.update(skills).set({ ...next, updatedAt: new Date() }).where(eq(skills.id, row.id)).run();
    const updated = db.select().from(skills).where(eq(skills.id, row.id)).limit(1).get();
    return { skill: toDto(updated!, assignmentCounts()), versionBumped: false };
  }

  return { skill: toDto(row, assignmentCounts()) };
}

export function deleteSkill(id: string): boolean {
  ensureBuiltinSkills();
  const row = getDb().select().from(skills).where(eq(skills.id, id)).limit(1).get();
  if (!row) return false;
  // Deleting a skill removes its whole history by key. Project assignments
  // cascade via the foreign key.
  getDb().delete(skills).where(eq(skills.skillKey, row.skillKey)).run();
  return true;
}

export function restoreSkillVersion(skillKey: string, version: number): UpdateSkillResult {
  ensureBuiltinSkills();
  const db = getDb();
  const history = db.select().from(skills).where(eq(skills.skillKey, skillKey)).orderBy(desc(skills.version)).all();
  const source = history.find((row) => row.version === version);
  if (!source) return { error: "Version not found." };
  const latestVersion = history[0]?.version ?? 1;
  const inserted = db
    .insert(skills)
    .values({
      skillKey,
      version: latestVersion + 1,
      name: source.name,
      description: source.description ?? "",
      taskTypes: source.taskTypes ?? [],
      instructions: source.instructions ?? "",
      requiredTools: source.requiredTools ?? [],
      source: source.source,
      provenance: source.provenance ?? {},
      trustStatus: source.trustStatus,
      integrityHash: source.integrityHash,
      enabled: true,
    })
    .returning()
    .get();
  return { skill: toDto(inserted, assignmentCounts()), versionBumped: true };
}

/* ------------------------------------------------------------------ */
/* Import / export                                                     */
/* ------------------------------------------------------------------ */

export interface ImportedSkillPayload {
  name: string;
  description?: string;
  taskTypes?: string[];
  instructions?: string;
  requiredTools?: string[];
  version?: number;
  source?: SkillSource;
  provenance?: { url?: string | null; retrievedAt?: number | null; contentHash?: string | null };
}

export type ImportSkillResult =
  | { skill: SkillDto }
  | { error: string; reason: "malformed" | "rejected" | "oversized" };

export function importSkill(raw: unknown): ImportSkillResult {
  let payload: ImportedSkillPayload;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw) as ImportedSkillPayload;
    } catch {
      return { error: "Imported skill must be valid JSON.", reason: "malformed" };
    }
  } else {
    payload = raw as ImportedSkillPayload;
  }

  if (!payload || typeof payload !== "object") return { error: "Imported skill must be an object.", reason: "malformed" };
  if (typeof payload.name !== "string" || !payload.name.trim()) return { error: "A skill name is required.", reason: "malformed" };
  if (typeof payload.instructions !== "string" || payload.instructions.length > 20000) {
    return { error: "Skill instructions must be text up to 20,000 characters.", reason: "oversized" };
  }
  if (typeof payload.description === "string" && payload.description.length > 2000) {
    return { error: "Skill description is too long (max 2,000 characters).", reason: "oversized" };
  }
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 50) : [];
  if (payload.instructions.includes("<script")) {
    return { error: "Rejected: skill payload declares an executable <script> block. Skills are prompt text only.", reason: "rejected" };
  }
  const asRecord = payload as unknown as Record<string, unknown>;
  if ("executable" in asRecord || "code" in asRecord) {
    return { error: "Rejected: skill payload declares executable content. Skills are prompt text only.", reason: "rejected" };
  }
  const provenance = payload.provenance && typeof payload.provenance === "object" ? payload.provenance : {};
  const url = typeof provenance.url === "string" && provenance.url ? provenance.url : null;
  const created = createSkill(
    {
      name: payload.name,
      description: payload.description ?? "",
      taskTypes: list(payload.taskTypes),
      instructions: payload.instructions,
      requiredTools: list(payload.requiredTools),
    },
    {
      source: "imported",
      provenance: { url, retrievedAt: typeof provenance.retrievedAt === "number" ? provenance.retrievedAt : null, contentHash: typeof provenance.contentHash === "string" ? provenance.contentHash.slice(0, 128) : null },
      trustStatus: trustForProvenance(url),
    }
  );
  if ("error" in created) return { error: created.error, reason: "malformed" };
  return { skill: created.skill };
}

export function exportSkill(skillKey: string): ImportedSkillPayload | null {
  ensureBuiltinSkills();
  const row = getDb()
    .select()
    .from(skills)
    .where(eq(skills.skillKey, skillKey))
    .orderBy(desc(skills.version))
    .limit(1)
    .get();
  if (!row) return null;
  return {
    name: row.name,
    description: row.description ?? "",
    taskTypes: row.taskTypes ?? [],
    instructions: row.instructions ?? "",
    requiredTools: row.requiredTools ?? [],
    version: row.version,
    source: row.source,
    provenance: row.provenance ?? {},
  };
}

/* ------------------------------------------------------------------ */
/* Project assignment + prompt injection                               */
/* ------------------------------------------------------------------ */

export function assignSkillToProject(projectId: string, skillId: string): boolean {
  const db = getDb();
  const skill = db.select().from(skills).where(eq(skills.id, skillId)).limit(1).get();
  if (!skill) return false;
  const existing = db
    .select()
    .from(projectSkills)
    .where(and(eq(projectSkills.projectId, projectId), eq(projectSkills.skillId, skillId)))
    .limit(1)
    .get();
  if (!existing) {
    db.insert(projectSkills).values({ projectId, skillId }).run();
  }
  return true;
}

export function unassignSkillFromProject(projectId: string, skillId: string): boolean {
  return (
    getDb()
      .delete(projectSkills)
      .where(and(eq(projectSkills.projectId, projectId), eq(projectSkills.skillId, skillId)))
      .run().changes > 0
  );
}

/** Latest versions of the skills assigned to a project, newest first. */
export function listProjectSkills(projectId: string): SkillDto[] {
  ensureBuiltinSkills();
  const db = getDb();
  const joins = db.select().from(projectSkills).where(eq(projectSkills.projectId, projectId)).all();
  if (!joins.length) return [];
  const joinedIds = new Set(joins.map((join) => join.skillId));
  // Assignment follows the skill key, not one version row: find the keys of
  // every joined row, then resolve each key to its latest version.
  const all = db.select().from(skills).all();
  const keys = new Set(all.filter((row) => joinedIds.has(row.id)).map((row) => row.skillKey));
  const counts = assignmentCounts();
  return latestPerKey(all.filter((row) => keys.has(row.skillKey)))
    .reverse()
    .map((row) => toDto(row, counts));
}

const SKILL_CONTEXT_LIMIT = 8000;

/**
 * Renders the assigned, enabled skills as system-prompt instructions. Skills
 * are untrusted text: they shape behavior, never grant permissions or execute
 * code. The model is told to treat them as guidance the user can remove.
 */
export function activeSkillInstructions(projectId: string | null | undefined): string {
  if (!projectId) return "";
  const assigned = listProjectSkills(projectId).filter((skill) => skill.enabled);
  if (!assigned.length) return "";
  const blocks = assigned.map(
    (skill) =>
      "Skill: " + skill.name + " (v" + skill.version + ")" +
      (skill.description ? " - " + skill.description : "") + "\n" +
      (skill.taskTypes.length ? "When the task matches: " + skill.taskTypes.join(", ") + "\n" : "") +
      skill.instructions
  );
  let joined = "Active skills for this project (follow them only where they fit; the user can remove or edit any of them):\n" + blocks.join("\n\n") + "\n";
  if (joined.length > SKILL_CONTEXT_LIMIT) {
    joined = joined.slice(0, SKILL_CONTEXT_LIMIT) + "\n[Skill instructions truncated - edit the skill to reduce its length.]";
  }
  return joined;
}