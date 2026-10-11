/**
 * `<memory>…</memory>` blocks are how the model proposes facts to remember. The
 * server stores them; the transcript shows the plain answer plus a small chip,
 * so this helper is shared by the message renderer and any other client code.
 */

export const MEMORY_TAG_PATTERN = /<memory>([\s\S]*?)<\/memory>/gi;

export function splitMemoryTags(text: string): { text: string; proposals: string[] } {
  const proposals: string[] = [];
  const clean = text.replace(MEMORY_TAG_PATTERN, (_match, body: string) => {
    const fact = String(body).replace(/\s+/g, " ").trim();
    if (fact.length >= 3) proposals.push(fact.slice(0, 1000));
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), proposals };
}