/**
 * Deterministic seeding for the craft engine.
 *
 * Art direction must be *stable* for a given deliverable (so regenerating
 * "landing-page" twice keeps its identity and the diff stays readable) and
 * *different* across deliverables (so two sites in a row never look like
 * siblings). A hash of the identity plus a small PRNG gives both without any
 * stored state.
 */

/** FNV-1a, 32-bit. Stable across runs, platforms and Node versions. */
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    // 16777619, written as shifts so the result stays in 32-bit range.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: tiny, fast, good enough distribution for design choices. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(items: readonly T[], random: () => number): T {
  if (!items.length) throw new Error("pick() needs a non-empty list");
  return items[Math.floor(random() * items.length) % items.length];
}

/** `count` distinct items, or everything when the list is shorter. */
export function pickMany<T>(items: readonly T[], count: number, random: () => number): T[] {
  const pool = [...items];
  const taken: T[] = [];
  while (pool.length && taken.length < count) {
    taken.push(...pool.splice(Math.floor(random() * pool.length) % pool.length, 1));
  }
  return taken;
}

/** An integer in [min, max]. */
export function pickInt(min: number, max: number, random: () => number): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return low + (Math.floor(random() * (high - low + 1)) % (high - low + 1));
}

/** A float in [min, max), rounded to `decimals`. */
export function pickFloat(min: number, max: number, random: () => number, decimals = 3): number {
  const value = min + random() * (max - min);
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
