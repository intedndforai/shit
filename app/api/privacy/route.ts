import { z } from "zod";
import { jsonError, jsonOk, parseJson, errorResponse } from "@/lib/server/api";
import {
  clearEgress,
  dataSummary,
  deleteAllData,
  destinationSummary,
  getPrivacySettings,
  policyLabel,
  policyOf,
  purgeExpiredChats,
  setPrivacySettings,
} from "@/lib/server/privacy";
import { listProviders } from "@/lib/server/providers";
import { isLocalEndpoint } from "@/lib/privacy/pipeline";
import {
  minimumPolicyLevels,
  privacyModes,
  PRIVACY_MODE_INFO,
} from "@/lib/privacy/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  defaultMode: z.enum(privacyModes).optional(),
  minimumProviderPolicy: z.enum(minimumPolicyLevels).optional(),
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  blockRemoteImages: z.boolean().optional(),
  requireSendPreview: z.boolean().optional(),
  customRedactionTerms: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  customRedactionPatterns: z.array(z.string().max(400)).max(50).optional(),
});

const actionSchema = z.object({
  action: z.enum(["purge", "delete-all", "clear-egress"]),
  includeProviders: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
});

function providerPolicies() {
  return listProviders().map((provider) => {
    const policy = policyOf({
      dataPolicyTraining: provider.dataPolicyTraining,
      dataPolicyRetention: provider.dataPolicyRetention,
      dataPolicyRegion: provider.dataPolicyRegion,
      dataPolicyUrl: provider.dataPolicyUrl,
      dataPolicyDeclaredBy: provider.dataPolicyDeclaredBy,
      dataPolicyDeclaredAt: provider.dataPolicyDeclaredAt ? new Date(provider.dataPolicyDeclaredAt) : null,
    });
    const local = isLocalEndpoint(provider.baseUrl);
    return {
      id: provider.id,
      name: provider.name,
      apiFormat: provider.apiFormat,
      host: (() => {
        try {
          return new URL(provider.baseUrl).hostname;
        } catch {
          return provider.baseUrl;
        }
      })(),
      local,
      policy,
      label: policyLabel(policy, local),
    };
  });
}

/** GET /api/privacy — settings, storage summary, destinations, and policies. */
export async function GET() {
  try {
    return jsonOk({
      settings: getPrivacySettings(),
      summary: dataSummary(),
      destinations: destinationSummary(),
      providers: providerPolicies(),
      modes: PRIVACY_MODE_INFO,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** PATCH /api/privacy — update the workspace privacy settings. */
export async function PATCH(request: Request) {
  const parsed = await parseJson(request, settingsSchema);
  if (!parsed.ok) return parsed.response;
  try {
    return jsonOk({ settings: setPrivacySettings(parsed.data) });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/privacy — retention purge or the confirmed "delete all my data".
 * Both are destructive and irreversible, so they are explicit POST actions.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, actionSchema);
  if (!parsed.ok) return parsed.response;

  try {
    if (parsed.data.action === "clear-egress") {
      return jsonOk({ ok: true, cleared: clearEgress() });
    }
    if (parsed.data.action === "purge") {
      const settings = getPrivacySettings();
      const days = parsed.data.retentionDays ?? settings.retentionDays;
      if (!days) {
        return jsonError("Set a retention window first, or pass retentionDays.", 400);
      }
      return jsonOk({ ok: true, result: purgeExpiredChats(days) });
    }
    const result = deleteAllData({ includeProviders: parsed.data.includeProviders });
    return jsonOk({ ok: true, result });
  } catch (error) {
    return errorResponse(error);
  }
}
