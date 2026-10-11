import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { artifacts, type Artifact, type ArtifactType } from "@/lib/db/schema";
import { parseArtifacts, type ParsedArtifact } from "@/lib/artifacts";

/**
 * Artifacts are code/UI blocks the model emits inside `<artifact>` tags. Every
 * emission is stored as a new version sharing the model-supplied identifier, so
 * the panel can diff revisions instead of losing them.
 */

export type { ParsedArtifact } from "@/lib/artifacts";

export function recordArtifacts(input: {
  chatId: string;
  messageId: string;
  text: string;
}): ParsedArtifact[] {
  const parsed = parseArtifacts(input.text);
  if (!parsed.length) return [];

  const db = getDb();
  const stored: ParsedArtifact[] = [];

  for (const artifact of parsed) {
    const latest = db
      .select({ version: artifacts.version })
      .from(artifacts)
      .where(and(eq(artifacts.chatId, input.chatId), eq(artifacts.identifier, artifact.identifier)))
      .orderBy(desc(artifacts.version))
      .limit(1)
      .get();

    db.insert(artifacts)
      .values({
        chatId: input.chatId,
        messageId: input.messageId,
        identifier: artifact.identifier,
        type: artifact.type,
        title: artifact.title,
        content: artifact.content,
        version: (latest?.version ?? 0) + 1,
      })
      .run();

    stored.push(artifact);
  }

  return stored;
}

export interface ArtifactDto {
  id: string;
  chatId: string;
  messageId: string | null;
  identifier: string;
  type: ArtifactType;
  title: string | null;
  content: string;
  version: number;
  createdAt: number;
  versionCount: number;
}

function withVersionCount(row: Artifact, versionCount: number): ArtifactDto {
  return {
    id: row.id,
    chatId: row.chatId,
    messageId: row.messageId,
    identifier: row.identifier,
    type: row.type,
    title: row.title,
    content: row.content,
    version: row.version,
    createdAt: row.createdAt.getTime(),
    versionCount,
  };
}

function countVersions(chatId: string, identifier: string): number {
  return getDb()
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(and(eq(artifacts.chatId, chatId), eq(artifacts.identifier, identifier)))
    .all().length;
}

/** Latest version of every artifact, newest chat activity first. */
export function listArtifacts(chatId?: string): ArtifactDto[] {
  const db = getDb();
  const rows = chatId
    ? db.select().from(artifacts).where(eq(artifacts.chatId, chatId)).orderBy(asc(artifacts.createdAt)).all()
    : db.select().from(artifacts).orderBy(desc(artifacts.createdAt)).limit(400).all();

  const latest = new Map<string, Artifact>();
  for (const row of rows) {
    const key = `${row.chatId}:${row.identifier}`;
    const current = latest.get(key);
    if (!current || current.version < row.version) latest.set(key, row);
  }

  return [...latest.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((row) => withVersionCount(row, countVersions(row.chatId, row.identifier)));
}

export function getArtifact(id: string): ArtifactDto | undefined {
  const row = getDb().select().from(artifacts).where(eq(artifacts.id, id)).get();
  if (!row) return undefined;
  return withVersionCount(row, countVersions(row.chatId, row.identifier));
}

/** Every stored version of one artifact, oldest first (used by the diff view). */
export function artifactVersions(chatId: string, identifier: string): ArtifactDto[] {
  const rows = getDb()
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.chatId, chatId), eq(artifacts.identifier, identifier)))
    .orderBy(asc(artifacts.version))
    .all();

  return rows.map((row) => withVersionCount(row, rows.length));
}