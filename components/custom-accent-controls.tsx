"use client";

import { DEFAULT_CUSTOM_ACCENT, DEFAULT_CUSTOM_GLOW, normalizeHex } from "@/lib/accent";
import { useUIStore } from "@/lib/store/ui-store";

export function CustomAccentControls() {
  const customAccent = useUIStore((s) => s.customAccent);
  const setCustomAccent = useUIStore((s) => s.setCustomAccent);
  const setAccent = useUIStore((s) => s.setAccent);
  const customGlow = useUIStore((s) => s.customGlow);
  const setCustomGlow = useUIStore((s) => s.setCustomGlow);
  const glowMode = useUIStore((s) => s.glowMode);
  const setGlowMode = useUIStore((s) => s.setGlowMode);

  const accentHex = normalizeHex(customAccent) ?? DEFAULT_CUSTOM_ACCENT;
  const glowHex = normalizeHex(customGlow) ?? DEFAULT_CUSTOM_GLOW;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border p-3 text-sm">
      <label className="flex items-center gap-2">
        Accent
        <input
          type="color"
          aria-label="Pick a custom accent color"
          value={accentHex}
          onChange={(event) => {
            setCustomAccent(event.target.value);
            setAccent("custom");
          }}
          className="h-8 w-8 cursor-pointer rounded-full border border-border bg-transparent p-0.5"
        />
      </label>
      <label className="flex items-center gap-2">
        Glow
        <input
          type="color"
          aria-label="Pick a custom glow color"
          value={glowHex}
          onChange={(event) => {
            setCustomGlow(event.target.value);
            setGlowMode("custom");
            setAccent("custom");
          }}
          className="h-8 w-8 cursor-pointer rounded-full border border-border bg-transparent p-0.5"
        />
      </label>
      <button
        type="button"
        onClick={() => setGlowMode(glowMode === "custom" ? "accent" : "custom")}
        className="h-8 rounded-full border border-border px-3 text-xs"
      >
        {glowMode === "custom" ? "Glow: custom" : "Glow: matches accent"}
      </button>
      <span className="ml-auto font-mono text-xs text-muted-foreground">{accentHex}</span>
    </div>
  );
}