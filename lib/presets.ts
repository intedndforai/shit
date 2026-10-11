/**
 * Conversation-control presets. The built-in four are always available; the
 * user can add their own in Settings -> Presets.
 */

export interface ChatPreset {
  id: string;
  name: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  thinkingBudget: number | null;
  systemPrompt?: string | null;
  builtin?: boolean;
}

export const BUILTIN_PRESETS: ChatPreset[] = [
  { id: "balanced", name: "Balanced", temperature: 0.7, topP: 1, maxTokens: 8192, thinkingBudget: null, builtin: true },
  { id: "precise", name: "Precise", temperature: 0.2, topP: 0.9, maxTokens: 4096, thinkingBudget: 0, builtin: true },
  { id: "creative", name: "Creative", temperature: 1.05, topP: 0.98, maxTokens: 8192, thinkingBudget: null, builtin: true },
  { id: "deep", name: "Deep reasoning", temperature: 0.4, topP: 1, maxTokens: 16384, thinkingBudget: 8000, builtin: true },
];

export function presetById(presets: ChatPreset[], id: string): ChatPreset | undefined {
  return presets.find((preset) => preset.id === id);
}

/** Which built-in preset the current controls look like, if any. */
export function matchPreset(presets: ChatPreset[], controls: {
  temperature: number;
  topP: number;
  maxTokens: number;
  thinkingBudget: number | null;
}): ChatPreset | undefined {
  return presets.find(
    (preset) =>
      Math.abs(preset.temperature - controls.temperature) < 0.001 &&
      Math.abs(preset.topP - controls.topP) < 0.001 &&
      preset.maxTokens === controls.maxTokens &&
      (preset.thinkingBudget ?? null) === (controls.thinkingBudget ?? null)
  );
}