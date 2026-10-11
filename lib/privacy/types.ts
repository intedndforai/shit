/**
 * Privacy-layer contracts shared by the server pipeline and the UI.
 * Types only (plus tiny pure helpers) so client components can import this.
 */

import type { SensitiveKind } from "./redact";

export const privacyModes = ["standard", "private", "incognito", "local"] as const;
export type PrivacyMode = (typeof privacyModes)[number];

export interface PrivacyModeInfo {
  label: string;
  /** One-line summary used by the badge and the mode picker. */
  summary: string;
  /** Longer explanation shown in the Privacy Center and tooltips. */
  detail: string;
}

export const PRIVACY_MODE_INFO: Record<PrivacyMode, PrivacyModeInfo> = {
  standard: {
    label: "Standard",
    summary: "Normal storage and features",
    detail:
      "Chats are stored in the local SQLite database and tools run with their normal permissions. A send preview and destination badge are always available.",
  },
  private: {
    label: "Private",
    summary: "Minimized + redacted, policy-gated",
    detail:
      "Reversible redaction is on, memory is off, the provider data-policy gate is enforced, and third-party tools ask every time. Auxiliary AI calls fall back to local options unless you approve a destination.",
  },
  incognito: {
    label: "Incognito",
    summary: "Ephemeral, nothing persisted",
    detail:
      "Nothing is written to SQLite or IndexedDB: no memory read or write, no search, no export, no AI title, and no content in usage records. A reload ends the chat by design.",
  },
  local: {
    label: "Strict Local",
    summary: "Local endpoints only, no third-party egress",
    detail:
      "Only explicitly allowlisted loopback or private-network model endpoints may be used. Third-party tools, web search and fetch, MCP servers, remote embeddings, and remote speech are disabled.",
  },
};

export const providerTrainingPolicies = ["unknown", "opt-out-requested", "not-applicable"] as const;
export type ProviderTrainingPolicy = (typeof providerTrainingPolicies)[number];

export const providerRetentionPolicies = [
  "unknown",
  "standard",
  "zero-retention-requested",
  "local",
] as const;
export type ProviderRetentionPolicy = (typeof providerRetentionPolicies)[number];

export interface ProviderPolicy {
  training: ProviderTrainingPolicy;
  retention: ProviderRetentionPolicy;
  region: string | null;
  url: string | null;
  declaredBy: string | null;
  declaredAt: number | null;
}

export const minimumPolicyLevels = ["any", "no-training", "zero-retention", "local-only"] as const;
export type MinimumPolicy = (typeof minimumPolicyLevels)[number];

export const MINIMUM_POLICY_LABELS: Record<MinimumPolicy, string> = {
  any: "Any provider",
  "no-training": "Opt-out of training requested (or local)",
  "zero-retention": "Zero-retention requested (or local)",
  "local-only": "Local endpoints only",
};

export interface PrivacySettings {
  /** Workspace default applied to new chats. */
  defaultMode: PrivacyMode;
  minimumProviderPolicy: MinimumPolicy;
  /** null = keep everything until the user deletes it. */
  retentionDays: number | null;
  blockRemoteImages: boolean;
  requireSendPreview: boolean;
  customRedactionTerms: string[];
  customRedactionPatterns: string[];
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  defaultMode: "standard",
  minimumProviderPolicy: "any",
  retentionDays: null,
  blockRemoteImages: true,
  requireSendPreview: false,
  customRedactionTerms: [],
  customRedactionPatterns: [],
};

export interface PolicyGateOption {
  kind: "switch-model" | "change-mode" | "send-once";
  label: string;
  description: string;
}

export interface PolicyGateResult {
  allowed: boolean;
  reasons: string[];
  options: PolicyGateOption[];
  providerLabel: string;
  minimum: MinimumPolicy;
}

export interface RedactionSummaryItem {
  placeholder: string;
  kind: SensitiveKind;
  credential: boolean;
  /** Masked preview of the real value — never the value itself. */
  preview: string;
  count: number;
}

export interface RedactionSummary {
  applied: boolean;
  total: number;
  items: RedactionSummaryItem[];
}

export interface SendPreview {
  mode: PrivacyMode;
  destination: { kind: "provider" | "local"; label: string; host: string };
  model: string;
  policy: ProviderPolicy;
  gate: PolicyGateResult;
  messages: { count: number; roles: Record<string, number> };
  attachments: Array<{ name: string; kind: string; size: number }>;
  memory: { included: boolean; items: number };
  tools: Array<{ name: string; label: string; egress: ToolEgress }>;
  redactions: RedactionSummary;
  credentials: RedactionSummaryItem[];
  systemPromptChars: number;
  approxInputTokens: number;
  /** SHA-256 of the redacted payload; content itself is never returned. */
  payloadHash: string;
  notes: string[];
}

export type ToolEgress =
  | { kind: "none"; note?: string }
  | { kind: "local"; note?: string }
  | { kind: "thirdParty"; destination?: string; note?: string };
