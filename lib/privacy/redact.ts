/**
 * Best-effort reversible redaction (pseudonymization).
 *
 * This module is deliberately dependency-free and environment-agnostic so it
 * runs on the server (the privacy pipeline) and in the browser (previews).
 *
 * Detection is best-effort, not a guarantee. Every placeholder is stable for
 * the request: the same value always maps to the same placeholder, and the
 * mapping is restored before display and before saving (Section 3.6).
 */

export type SensitiveKind =
  | "email"
  | "phone"
  | "api-key"
  | "token"
  | "private-key"
  | "jwt"
  | "password"
  | "card"
  | "iban"
  | "national-id"
  | "ip"
  | "file-path"
  | "custom";

export interface RedactionMatch {
  kind: SensitiveKind;
  /** 0-based offset of the first character of the value. */
  start: number;
  /** 0-based offset one past the last character of the value. */
  end: number;
  value: string;
  /** Credentials default to block-and-ask: never sent without an allow. */
  credential: boolean;
}

export interface RedactionEntry {
  placeholder: string;
  value: string;
  kind: SensitiveKind;
  credential: boolean;
}

export interface RedactResult {
  text: string;
  entries: RedactionEntry[];
}

export interface RedactOptions {
  /** User-defined regex sources. Invalid patterns are skipped silently. */
  customPatterns?: string[];
  /** Literal dictionary terms (names, addresses, project codenames). */
  customTerms?: string[];
}

const LABELS: Record<SensitiveKind, string> = {
  email: "EMAIL",
  phone: "PHONE",
  "api-key": "SECRET",
  token: "SECRET",
  "private-key": "SECRET",
  jwt: "SECRET",
  password: "SECRET",
  card: "SECRET",
  iban: "SECRET",
  "national-id": "SECRET",
  ip: "IP",
  "file-path": "PATH",
  custom: "CUSTOM",
};

const CREDENTIAL_KINDS = new Set<SensitiveKind>([
  "api-key",
  "token",
  "private-key",
  "jwt",
  "password",
  "card",
  "iban",
  "national-id",
  "custom",
]);

function isCredential(kind: SensitiveKind): boolean {
  return CREDENTIAL_KINDS.has(kind);
}

/* ------------------------------------------------------------------ */
/* Detectors                                                           */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

/** Loose international phone: optional +, then 7-15 grouped digits. */
const PHONE_RE = /(?:\+\d{1,3}[ .\-]?)?(?:\(\d{2,4}\)[ .\-]?)?\d{3,4}[ .\-]?\d{3,4}(?:[ .\-]?\d{2,4})?/g;

const IPV4_RE =
  /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;

const JWT_RE = /\beyJ[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{5,}\b/g;

const PRIVATE_KEY_RE =
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]{0,8192}?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g;

const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{2,4}){2,8}\b/g;
const NATIONAL_ID_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

const TOKEN_PREFIX_RE =
  /\b(?:sk|pk|rk)-[A-Za-z0-9_\-]{12,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_\-]{30,}\b|\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g;

const BEARER_RE = /\b(?:Bearer|Token)\s+[A-Za-z0-9._\-]{16,}\b/gi;

const PASSWORD_RE =
  /(?:password|passwd|pwd|passphrase|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?([^\s"',;]{6,})["']?/gi;

/** URLs/params that embed a key: ?api_key=..., &token=... */
const KEY_PARAM_RE = /[?&](?:api[_-]?key|apikey|access[_-]?token|token|key|secret)=([A-Za-z0-9._\-]{12,})/gi;

const USER_PATH_RE =
  /(?:\/(?:Users|home)\/[^\s/\\]+|[A-Za-z]:\\Users\\[^\s\\]+)(?:[\/][^\s"'`<>|]*)*/g;

function luhnValid(digits: string): boolean {
  const clean = digits.replace(/[^0-9]/g, "");
  if (clean.length < 13 || clean.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = clean.length - 1; i >= 0; i -= 1) {
    let d = clean.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function ibanValid(raw: string): boolean {
  const value = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(value)) return false;
  const rearranged = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = char >= "A" && char <= "Z" ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of code) {
      remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder === 1;
}

function jwtLooksReal(token: string): boolean {
  const [header, payload] = token.split(".");
  if (!header || !payload) return false;
  try {
    const decode = (segment: string) => {
      const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
      const json = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
      return JSON.parse(json) as Record<string, unknown>;
    };
    const head = decode(header);
    const body = decode(payload);
    return Boolean((head.alg || head.typ) && Object.keys(body).length);
  } catch {
    return false;
  }
}

interface Pattern {
  kind: SensitiveKind;
  re: RegExp;
  /** Optional post-filter to reject false positives (e.g. Luhn, mod-97). */
  validate?: (value: string) => boolean;
  /** Reduce a regex match (with capture groups) to the value to redact. */
  extract?: (match: RegExpExecArray) => string;
}

const PATTERNS: Pattern[] = [
  { kind: "private-key", re: PRIVATE_KEY_RE },
  { kind: "email", re: EMAIL_RE },
  { kind: "jwt", re: JWT_RE, validate: jwtLooksReal },
  { kind: "api-key", re: TOKEN_PREFIX_RE },
  { kind: "token", re: BEARER_RE, extract: (m) => m[0].replace(/^(?:Bearer|Token)\s+/i, "") },
  { kind: "card", re: CARD_RE, validate: luhnValid },
  { kind: "iban", re: IBAN_RE, validate: ibanValid },
  { kind: "national-id", re: NATIONAL_ID_RE },
  { kind: "file-path", re: USER_PATH_RE },
  { kind: "ip", re: IPV4_RE },
  {
    kind: "password",
    re: PASSWORD_RE,
    extract: (m) => m[1] ?? m[0],
  },
  { kind: "api-key", re: KEY_PARAM_RE, extract: (m) => m[1] ?? m[0] },
  { kind: "phone", re: PHONE_RE, validate: (value) => { const digits = value.replace(/\D/g, "").length;
      return digits >= 9 && digits <= 15 && /[+().\-\s]/.test(value); } },
];

function matchOffset(match: RegExpExecArray, value: string): number {
  const index = match[0].indexOf(value);
  return match.index + (index < 0 ? 0 : index);
}

function addMatches(matches: RedactionMatch[], pattern: Pattern, text: string): void {
  const re = new RegExp(pattern.re.source, pattern.re.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    const value = pattern.extract ? pattern.extract(match) : match[0];
    if (!value) continue;
    if (pattern.validate && !pattern.validate(value)) continue;
    // Ignore pure-separator or whitespace-only matches.
    if (!/[A-Za-z0-9]/.test(value)) continue;
    matches.push({
      kind: pattern.kind,
      start: matchOffset(match, value),
      end: matchOffset(match, value) + value.length,
      value,
      credential: isCredential(pattern.kind),
    });
  }
}

export function detectSensitive(text: string, options: RedactOptions = {}): RedactionMatch[] {
  if (!text) return [];
  const matches: RedactionMatch[] = [];
  for (const pattern of PATTERNS) addMatches(matches, pattern, text);

  for (const term of options.customTerms ?? []) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    addMatches(matches, { kind: "custom", re: new RegExp(escaped, "g") }, text);
  }

  for (const source of options.customPatterns ?? []) {
    try {
      addMatches(matches, { kind: "custom", re: new RegExp(source, "g") }, text);
    } catch {
      /* an invalid user pattern must not break the pipeline */
    }
  }

  // Drop overlapping matches, preferring the longer (then earlier) match.
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: RedactionMatch[] = [];
  let cursor = -1;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.end <= match.start) continue;
    kept.push(match);
    cursor = match.end;
  }
  return kept;
}

export function credentialMatches(text: string, options: RedactOptions = {}): RedactionMatch[] {
  return detectSensitive(text, options).filter((match) => match.credential);
}

export function redactText(text: string, options: RedactOptions = {}): RedactResult {
  const matches = detectSensitive(text, options);
  if (!matches.length) return { text, entries: [] };

  const byValue = new Map<string, RedactionEntry>();
  const counters = new Map<string, number>();
  const entries: RedactionEntry[] = [];
  let out = "";
  let cursor = 0;

  for (const match of matches) {
    out += text.slice(cursor, match.start);
    const label = LABELS[match.kind];
    let entry = byValue.get(match.value);
    if (!entry) {
      const next = (counters.get(label) ?? 0) + 1;
      counters.set(label, next);
      entry = {
        placeholder: `[${label}_${next}]`,
        value: match.value,
        kind: match.kind,
        credential: match.credential,
      };
      byValue.set(match.value, entry);
      entries.push(entry);
    }
    out += entry.placeholder;
    cursor = match.end;
  }
  out += text.slice(cursor);

  return { text: out, entries };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function restoreText(text: string, entries: RedactionEntry[]): string {
  let out = text;
  for (const entry of entries) {
    out = out.replace(new RegExp(escapeRegExp(entry.placeholder), "g"), () => entry.value);
  }
  return out;
}

/**
 * Streaming-safe restorer. Provider text arrives in deltas that may split a
 * placeholder across chunks; this never emits a partial placeholder.
 */
export class PlaceholderRestorer {
  private buffer = "";
  private readonly map: Map<string, string>;
  private readonly prefixes: Set<string>;
  private readonly maxPrefixLength: number;
  private restored = 0;

  constructor(entries: RedactionEntry[]) {
    this.map = new Map(entries.map((entry) => [entry.placeholder, entry.value]));
    // Every strict prefix (starting at "[") that could be a split placeholder.
    const prefixes = new Set<string>();
    let max = 1;
    for (const placeholder of this.map.keys()) {
      for (let i = 1; i < placeholder.length; i += 1) {
        const prefix = placeholder.slice(0, i);
        prefixes.add(prefix);
        if (prefix.length > max) max = prefix.length;
      }
    }
    this.prefixes = prefixes;
    this.maxPrefixLength = max;
  }

  get pending(): string {
    return this.buffer;
  }

  get restoredCount(): number {
    return this.restored;
  }

  push(delta: string): string {
    const combined = this.buffer + delta;
    const safeLength = this.safeLength(combined);
    const emit = combined.slice(0, safeLength);
    this.buffer = combined.slice(safeLength);
    return this.replace(emit);
  }

  flush(): string {
    const emit = this.replace(this.buffer);
    this.buffer = "";
    return emit;
  }

  /** How much of `text` ends on a complete boundary (no partial placeholder tail). */
  private safeLength(text: string): number {
    if (!this.prefixes.size) return text.length;
    const floor = Math.max(0, text.length - this.maxPrefixLength - 1);
    // Walk back from the last "[" to the first one still close enough to the end
    // to be a placeholder that could still grow. The update must always move
    // backwards: `lastIndexOf("[", -1)` clamps to 0, which would spin forever on a
    // buffer that starts with "[" (e.g. a delta that is exactly "[EMAIL_1]").
    for (let i = text.lastIndexOf("["); i >= floor; i = i > 0 ? text.lastIndexOf("[", i - 1) : -1) {
      // A tail like "[SEC" that could still grow into a known placeholder.
      if (this.prefixes.has(text.slice(i))) return i;
    }
    return text.length;
  }

  private replace(text: string): string {
    if (!this.map.size) return text;
    let out = text;
    for (const [placeholder, value] of this.map) {
      if (!out.includes(placeholder)) continue;
      out = out.split(placeholder).join(value);
      this.restored += 1;
    }
    return out;
  }
}
