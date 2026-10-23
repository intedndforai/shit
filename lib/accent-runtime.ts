import {
  DEFAULT_CUSTOM_ACCENT,
  accentForeground,
  accentGlow,
  accentSoft,
  normalizeHex,
} from "@/lib/accent";
import { useUIStore } from "@/lib/store/ui-store";

const ACCENT_VARS = ["--accent", "--accent-soft", "--accent-foreground", "--accent-glow", "--glow"];

type AccentState = {
  accent: string;
  customAccent: string;
  customGlow: string;
  glowMode: "accent" | "custom";
};

function applyAccentVariables(state: AccentState) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.accent = state.accent;

  if (state.accent !== "custom") {
    for (const name of ACCENT_VARS) root.style.removeProperty(name);
    return;
  }

  const accent = normalizeHex(state.customAccent) ?? DEFAULT_CUSTOM_ACCENT;
  const glow = state.glowMode === "custom" ? normalizeHex(state.customGlow) ?? accent : accent;

  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-soft", accentSoft(accent));
  root.style.setProperty("--accent-foreground", accentForeground(accent));
  root.style.setProperty("--accent-glow", accentGlow(glow));
  root.style.setProperty("--glow", accentGlow(glow));
}

if (typeof window !== "undefined") {
  applyAccentVariables(useUIStore.getState());
  useUIStore.subscribe((state) => applyAccentVariables(state));
}