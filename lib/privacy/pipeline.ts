/**
 * The privacy pipeline: minimize → redact → provider data-policy gate → send.
 *
 * Pure helpers live here so both the server route and the browser preview can
 * describe exactly what would leave the app. Nothing here performs I/O.
 */

import type { ContentPart } from "@/lib/db/schema";
import { redactText, type RedactOptions, type RedactionEntry, type RedactionMatch } from "./redact";
import type {
  MinimumPolicy,
  PolicyGateResult,
  PrivacyMode,
  ProviderPolicy,
  RedactionSummary,
  RedactionSummaryItem,
  ToolEgress,
} from "./types";

/* ------------------------------------------------------------------ */
/* Destinations                                                        */
/* ------------------------------------------------------------------ */

/** Hostname of a URL, or "(invalid URL)" when it cannot be parsed. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname || "(empty host)";
  } catch {
    return "(invalid URL)";
  }
}

const PRIVATE_HOST_RE =
  /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|.+\.local|.+\.internal|.+\.lan|host\.docker\.internal|host\.containers\.internal)$/i;

/** True for loopback, private-network, .local/.internal hosts (Section 3.3). */
export function isLocalEndpoint(baseUrl: string): boolean {
  if (!baseUrl) return false;
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return false;
  }
  if (PRIVATE_HOST_RE.test(host)) return true;
  // IPv6 loopback / unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^(fc|fd|fe8|fe9|fea|feb)[0-9a-f]{2}:/i.test(host)) return true;
  return false;
}

/** Classify a tool's egress from its destination, if it has one. */
export function classifyEgress(destination?: string | null): ToolEgress {
  if (!destination) return { kind: "none" };
  if (isLocalEndpoint(destination)) return { kind: "local" };
  return { kind: "thirdParty", destination: hostOf(destination) };
}

/* ------------------------------------------------------------------ */
/* Redaction                                                           */
/* ------------------------------------------------------------------ */

/** A short, non-reversible preview of a sensitive value (never the value). */
export function maskPreview(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "•".repeat(value.length);
  const head = value.slice(0, 2);
  const tail = value.slice(-2);
  return `${head}${"•".repeat(Math.min(8, value.length - 4))}${tail}`;
}

export function summarizeRedactions(
  input: Array<RedactionEntry | RedactionMatch>
): RedactionSummary {
  const items = new Map<string, RedactionSummaryItem>();
  for (const item of input) {
    const placeholder = "placeholder" in item ? item.placeholder : `[${item.kind}]`;
    const preview = maskPreview(item.value);
    const key = `${placeholder}:${preview}`;
    const existing = items.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    items.set(key, {
      placeholder,
      kind: item.kind,
      credential: item.credential,
      preview,
      count: 1,
    });
  }
  const list = [...items.values()];
  return { applied: list.length > 0, total: input.length, items: list };
}

/** Redact every text part in a message list, returning the mapping for restore. */
export function redactContent(
  content: ContentPart[],
  options: RedactOptions
): { content: ContentPart[]; entries: RedactionEntry[] } {
  const entries: RedactionEntry[] = [];
  const next = content.map((part) => {
    if (part.kind === "text") {
      const result = redactText(part.text, options);
      entries.push(...result.entries);
      return { ...part, text: result.text };
    }
    if (part.kind === "document" && part.text) {
      const result = redactText(part.text, options);
      entries.push(...result.entries);
      return { ...part, text: result.text };
    }
    if (part.kind === "tool_result") {
      // Tool output is untrusted and may echo user content back.
      const result = redactText(part.output, options);
      entries.push(...result.entries);
      return { ...part, output: result.text };
    }
    return part;
  });
  return { content: next, entries };
}

export interface RedactableMessage {
  role: string;
  content: ContentPart[];
}

export function redactMessages<T extends RedactableMessage>(
  messages: T[],
  options: RedactOptions
): { messages: T[]; entries: RedactionEntry[] } {
  const entries: RedactionEntry[] = [];
  const next = messages.map((message) => {
    const { content, entries: found } = redactContent(message.content, options);
    entries.push(...found);
    return { ...message, content };
  });
  return { messages: next, entries };
}

/* ------------------------------------------------------------------ */
/* Provider data-policy gate (Section 3.4)                             */
/* ------------------------------------------------------------------ */

export function policyGate(input: {
  policy: ProviderPolicy;
  providerLabel: string;
  mode: PrivacyMode;
  minimum: MinimumPolicy;
  isLocalEndpoint: boolean;
}): PolicyGateResult {
  const { policy, providerLabel, mode, minimum, isLocalEndpoint: local } = input;
  const options: PolicyGateResult["options"] = [
    {
      kind: "switch-model",
      label: "Switch to a compliant or local model",
      description: "Pick a model whose provider meets your minimum policy, or point a provider at a local endpoint.",
    },
    {
      kind: "change-mode",
      label: "Change the chat's privacy mode",
      description: "Standard keeps the provider's own defaults; Strict Local allows local endpoints only.",
    },
    {
      kind: "send-once",
      label: "Send this turn once anyway",
      description: "Sends only this turn; the gate stays enforced for the next one.",
    },
  ];

  if (mode !== "private") {
    return { allowed: true, reasons: [], options, providerLabel, minimum };
  }

  // A loopback/private endpoint is the operator's own machine or network, so a
  // provider data-policy declaration does not apply (Section 3.4).
  if (local) {
    return { allowed: true, reasons: [], options, providerLabel, minimum };
  }

  const reasons: string[] = [];
  if (minimum === "any") {
    // Still surface the declaration status honestly.
    if (policy.training === "unknown") {
      reasons.push("The provider's training policy is undeclared (unknown).");
    }
  } else if (minimum === "no-training") {
    if (policy.training === "unknown") {
      reasons.push("Your minimum policy requires a declared training opt-out, but this provider is undeclared.");
    }
    if (policy.retention === "unknown") {
      reasons.push("The provider's retention policy is undeclared.");
    }
  } else if (minimum === "zero-retention") {
    if (policy.retention !== "zero-retention-requested" && policy.retention !== "local") {
      reasons.push(
        policy.retention === "unknown"
          ? "Your minimum policy requires zero-retention, but this provider is undeclared."
          : "Your minimum policy requires zero-retention, but this provider is declared standard retention."
      );
    }
  } else if (minimum === "local-only") {
    if (!local) reasons.push("Your minimum policy allows local endpoints only, but this provider is remote.");
  }

  if (minimum === "any") {
    return { allowed: true, reasons, options, providerLabel, minimum };
  }
  return { allowed: reasons.length === 0, reasons, options, providerLabel, minimum };
}

/* ------------------------------------------------------------------ */
/* Provider-request data-control flags (Section 3.4)                   */
/* ------------------------------------------------------------------ */

export interface DataControlFlags {
  /** OpenRouter supports provider routing preferences for data collection. */
  openRouterDataCollection?: "deny" | "allow";
  /** OpenRouter zero-data-retention preference. */
  openRouterZdr?: boolean;
  /** Provider does not expose a request-level control. */
  unsupported: boolean;
  /** Plain-language note shown in the UI. */
  note: string;
}

/**
 * Compute documented, provider-specific data-control flags. Only parameters the
 * provider officially documents are emitted; otherwise we say so honestly.
 */
export function dataControlFlags(input: {
  apiFormat: string;
  baseUrl: string;
  training: ProviderPolicy["training"];
  retention: ProviderPolicy["retention"];
}): DataControlFlags {
  const host = hostOf(input.baseUrl);
  if (host.includes("openrouter.ai")) {
    return {
      openRouterDataCollection: "deny",
      openRouterZdr: input.retention === "zero-retention-requested",
      unsupported: false,
      note: 'OpenRouter: provider routing sets data_collection="deny" and, when you requested zero-retention, zdr=true.',
    };
  }
  return {
    unsupported: true,
    note: "The selected provider does not expose a documented request-level data control, so no data-control flag was sent.",
  };
}
