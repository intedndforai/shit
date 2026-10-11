import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chats, projectChunks, projectFiles, projects, type Project } from "@/lib/db/schema";
import { chunkText, cosineSimilarity, rankByBm25 } from "@/lib/rag/chunk";
import { embedTexts } from "@/lib/server/embeddings";
import { estimateTokens } from "@/lib/tokens";

/**
 * Projects are knowledge bases: a name, instructions, files, and the chats
 * scoped to them. Files are chunked and (when an embeddings provider is
 * configured) embedded; retrieval prefers vectors and falls back to BM25.
 */

export interface ProjectSummary extends Project {
  fileCount: number;
  chatCount: number;
}

export interface ProjectFileDto {
  id: string;
  name: string;
  mimeType: string | null;
  size: number;
  status: string;
  chunkCount: number;
  createdAt: number;
}

export interface RetrievedPassage {
  fileId: string;
  file: string;
  content: string;
  score: number;
}

export interface RetrievalResult {
  mode: "embeddings" | "keywords" | "none";
  passages: RetrievedPassage[];
}

function now(): Date {
  return new Date();
}

export function listProjects(): ProjectSummary[] {
  const db = getDb();
  const rows = db.select().from(projects).orderBy(desc(projects.updatedAt)).all();
  const files = db.select({ projectId: projectFiles.projectId }).from(projectFiles).all();
  const scoped = db.select({ projectId: chats.projectId }).from(chats).all();

  const countBy = (items: Array<{ projectId: string | null }>) =>
    items.reduce<Map<string, number>>((acc, item) => {
      if (!item.projectId) return acc;
      acc.set(item.projectId, (acc.get(item.projectId) ?? 0) + 1);
      return acc;
    }, new Map());

  const fileCounts = countBy(files);
  const chatCounts = countBy(scoped);

  return rows.map((row) => ({
    ...row,
    fileCount: fileCounts.get(row.id) ?? 0,
    chatCount: chatCounts.get(row.id) ?? 0,
  }));
}

export function getProject(id: string): ProjectSummary | undefined {
  return listProjects().find((project) => project.id === id);
}

export function createProject(input: { name: string; description?: string | null; instructions?: string | null }) {
  return getDb()
    .insert(projects)
    .values({
      name: input.name,
      description: input.description ?? null,
      instructions: input.instructions ?? null,
    })
    .returning()
    .get();
}

export function updateProject(
  id: string,
  patch: { name?: string; description?: string | null; instructions?: string | null }
) {
  const db = getDb();
  const row = db.update(projects).set({ ...patch, updatedAt: now() }).where(eq(projects.id, id)).returning().get();
  return row;
}

export function deleteProject(id: string): boolean {
  return getDb().delete(projects).where(eq(projects.id, id)).run().changes > 0;
}

export function listProjectFiles(projectId: string): ProjectFileDto[] {
  return getDb()
    .select()
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId))
    .orderBy(desc(projectFiles.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      mimeType: row.mimeType,
      size: row.size,
      status: row.status,
      chunkCount: row.chunkCount,
      createdAt: row.createdAt.getTime(),
    }));
}

/** Replaces a file's chunks with a fresh, optionally embedded, set. */
export async function indexProjectFile(fileId: string, text: string): Promise<{ chunks: number; embedded: boolean }> {
  const db = getDb();
  const file = db.select().from(projectFiles).where(eq(projectFiles.id, fileId)).limit(1).get();
  if (!file) throw new Error("Project file not found.");

  db.update(projectFiles).set({ status: "indexing" }).where(eq(projectFiles.id, fileId)).run();
  db.delete(projectChunks).where(eq(projectChunks.fileId, fileId)).run();

  const pieces = chunkText(text);
  if (!pieces.length) {
    db.update(projectFiles).set({ status: "failed", chunkCount: 0 }).where(eq(projectFiles.id, fileId)).run();
    return { chunks: 0, embedded: false };
  }

  const vectors = await embedTexts(pieces.map((piece) => piece.content));
  const embedded = Array.isArray(vectors);

  db.insert(projectChunks)
    .values(
      pieces.map((piece, index) => ({
        projectId: file.projectId,
        fileId,
        ordinal: piece.ordinal,
        content: piece.content,
        embedding: embedded ? vectors?.[index] ?? null : null,
        tokens: estimateTokens(piece.content),
      }))
    )
    .run();

  db.update(projectFiles)
    .set({ status: "indexed", chunkCount: pieces.length })
    .where(eq(projectFiles.id, fileId))
    .run();

  return { chunks: pieces.length, embedded };
}

export async function attachProjectFile(
  projectId: string,
  input: { name: string; mimeType?: string | null; size?: number; text: string }
): Promise<{ file: ProjectFileDto; embedded: boolean }> {
  const db = getDb();
  const row = db
    .insert(projectFiles)
    .values({
      projectId,
      name: input.name,
      mimeType: input.mimeType ?? null,
      size: input.size ?? input.text.length,
      status: "pending",
    })
    .returning()
    .get();

  db.update(projects).set({ updatedAt: now() }).where(eq(projects.id, projectId)).run();
  const result = await indexProjectFile(row.id, input.text);
  const file = listProjectFiles(projectId).find((item) => item.id === row.id);
  if (!file) throw new Error("Project file disappeared while indexing.");
  return { file, embedded: result.embedded };
}

export function deleteProjectFile(fileId: string): boolean {
  return getDb().delete(projectFiles).where(eq(projectFiles.id, fileId)).run().changes > 0;
}

/** Top-k passages for a question, using vectors when available and BM25 otherwise. */
export async function retrieveProjectContext(projectId: string, query: string, limit = 4): Promise<RetrievalResult> {
  const db = getDb();
  const rows = db
    .select()
    .from(projectChunks)
    .where(eq(projectChunks.projectId, projectId))
    .orderBy(asc(projectChunks.fileId), asc(projectChunks.ordinal))
    .all();

  if (!rows.length) return { mode: "none", passages: [] };

  const nameByFile = new Map(
    db
      .select({ id: projectFiles.id, name: projectFiles.name })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId))
      .all()
      .map((file) => [file.id, file.name])
  );

  const withVectors = rows.filter((row) => Array.isArray(row.embedding) && row.embedding.length);
  if (withVectors.length) {
    const [queryVector] = (await embedTexts([query])) ?? [];
    if (queryVector) {
      const scored = withVectors
        .map((row) => ({ row, score: cosineSimilarity(queryVector, row.embedding ?? []) }))
        .sort((a, b) => b.score - a.score)
        .filter((entry) => entry.score > 0.05)
        .slice(0, limit);
      if (scored.length) {
        return {
          mode: "embeddings",
          passages: scored.map((entry) => ({
            fileId: entry.row.fileId,
            file: nameByFile.get(entry.row.fileId) ?? "file",
            content: entry.row.content,
            score: Number(entry.score.toFixed(4)),
          })),
        };
      }
    }
  }

  const ranked = rankByBm25(
    query,
    rows.map((row) => row.content),
    limit
  );
  return {
    mode: ranked.length ? "keywords" : "none",
    passages: ranked.map((entry) => ({
      fileId: rows[entry.index].fileId,
      file: nameByFile.get(rows[entry.index].fileId) ?? "file",
      content: rows[entry.index].content,
      score: Number(entry.score.toFixed(4)),
    })),
  };
}

export function projectStats(projectId: string): { files: number; chunks: number; embedded: number } {
  const db = getDb();
  const files = db.select({ id: projectFiles.id }).from(projectFiles).where(eq(projectFiles.projectId, projectId)).all();
  const chunks = db
    .select({ id: projectChunks.id, embedding: projectChunks.embedding })
    .from(projectChunks)
    .where(eq(projectChunks.projectId, projectId))
    .all();
  return {
    files: files.length,
    chunks: chunks.length,
    embedded: chunks.filter((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length).length,
  };
}

/** Chats scoped to a project, newest first. */
export function projectChats(projectId: string) {
  return getDb()
    .select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt })
    .from(chats)
    .where(and(eq(chats.projectId, projectId), eq(chats.archived, false)))
    .orderBy(desc(chats.updatedAt))
    .all()
    .map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt.getTime() }));
}

export function countProjectFiles(): number {
  const row = getDb().get<{ n: number }>(sql`select count(*) as n from project_files`);
  return row?.n ?? 0;
}