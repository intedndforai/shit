/**
 * Retrieval helpers for project knowledge bases.
 *
 * Chunking is character-based and paragraph-aware: a personal knowledge base is
 * usually prose or code, and a fixed window with overlap keeps sentences (and
 * code blocks) from being cut in half.
 */

export interface ChunkOptions {
  size?: number;
  overlap?: number;
}

export interface Chunk {
  ordinal: number;
  content: string;
}

export function chunkText(text: string, { size = 1200, overlap = 180 }: ChunkOptions = {}): Chunk[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [{ ordinal: 0, content: clean }];

  const chunks: Chunk[] = [];
  let start = 0;
  let ordinal = 0;

  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      // Prefer a paragraph break, then a sentence, then a newline.
      const window = clean.slice(start, end);
      const candidates = [window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("\n")];
      const best = candidates.find((index) => index > size * 0.5);
      if (typeof best === "number" && best > 0) end = start + best + 1;
    }

    const content = clean.slice(start, end).trim();
    if (content) chunks.push({ ordinal: ordinal++, content });
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
}

/**
 * Okapi BM25 over a small set of passages. Used when no embeddings provider is
 * configured, which keeps retrieval working out of the box.
 */
export function rankByBm25(query: string, documents: string[], limit = 4): Array<{ index: number; score: number }> {
  const queryTerms = Array.from(new Set(tokenize(query)));
  if (!queryTerms.length || !documents.length) return [];

  const docTerms = documents.map((document) => tokenize(document));
  const lengths = docTerms.map((terms) => terms.length);
  const averageLength = lengths.reduce((total, length) => total + length, 0) / lengths.length || 1;
  const k1 = 1.5;
  const b = 0.75;

  const documentFrequency = new Map<string, number>();
  for (const terms of docTerms) {
    const unique = new Set(terms);
    for (const term of unique) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }

  const scored = docTerms.map((terms, index) => {
    const counts = new Map<string, number>();
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const frequency = counts.get(term);
      if (!frequency) continue;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      score += idf * ((frequency * (k1 + 1)) / (frequency + k1 * (1 - b + (b * lengths[index]) / averageLength)));
    }
    return { index, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, limit);
}

/** Cosine similarity; returns 0 for mismatched or empty vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}