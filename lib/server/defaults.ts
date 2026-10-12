import { BUILTIN_PRESETS, type ChatPreset } from "@/lib/presets";
import { getSetting, setSetting } from "@/lib/server/settings";
import { getDefaultModel, listStoredModels, setDefaultModel } from "@/lib/server/providers";

/**
 * Workspace defaults for brand-new chats.
 *
 * Two things can be chosen once and reused everywhere: the model a fresh chat
 * is pinned to, and the "AI performance" preset (sampling, output length, and
 * thinking budget) it starts with. Both are stored in app_settings, except the
 * model which reuses the existing `models.isDefault` flag so the rest of the
 * app keeps seeing one source of truth.
 */

const DEFAULT_PRESET_KEY = "defaults.presetId";
const FALLBACK_PRESET_ID = "balanced";

export interface ChatControlDefaults {
  temperature: number;
  topP: number;
  maxTokens: number;
  thinkingBudget: number | null;
}

export interface ChatDefaults {
  presetId: string;
  controls: ChatControlDefaults;
  modelId: string | null;
}

/** Built-in presets first, then whatever the user saved in Settings. */
export function allPresets(): ChatPreset[] {
  const stored = getSetting<ChatPreset[]>("chat.presets") ?? [];
  return [...BUILTIN_PRESETS, ...stored.map((preset) => ({ ...preset, builtin: false }))];
}

export function getDefaultPresetId(): string {
  const stored = getSetting<string>(DEFAULT_PRESET_KEY);
  if (stored && allPresets().some((preset) => preset.id === stored)) return stored;
  return FALLBACK_PRESET_ID;
}

/** The model a new chat uses: the flagged default, else the first stored one. */
export function getDefaultModelId(): string | null {
  return getDefaultModel()?.id ?? listStoredModels()[0]?.id ?? null;
}

export function getChatDefaults(): ChatDefaults {
  const presetId = getDefaultPresetId();
  const preset =
    allPresets().find((item) => item.id === presetId) ??
    BUILTIN_PRESETS.find((item) => item.id === FALLBACK_PRESET_ID) ??
    BUILTIN_PRESETS[0];

  return {
    presetId: preset.id,
    controls: {
      temperature: preset.temperature,
      topP: preset.topP,
      maxTokens: preset.maxTokens,
      thinkingBudget: preset.thinkingBudget ?? null,
    },
    modelId: getDefaultModelId(),
  };
}

export function setChatDefaults(patch: { presetId?: string; modelId?: string | null }): ChatDefaults {
  if (patch.presetId !== undefined) {
    if (!allPresets().some((preset) => preset.id === patch.presetId)) {
      throw new Error("That preset no longer exists.");
    }
    setSetting(DEFAULT_PRESET_KEY, patch.presetId);
  }
  if (patch.modelId) {
    const model = setDefaultModel(patch.modelId);
    if (!model) throw new Error("That model no longer exists.");
  }
  return getChatDefaults();
}