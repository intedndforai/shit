/**
 * Palette generation in OKLCH.
 *
 * Generated sites get a real colour system instead of the usual "indigo-500 on
 * white with a purple gradient". Everything is derived from one hue anchor and
 * a named harmony, so the result is coherent by construction, and lightness is
 * chosen in OKLCH (perceptual) so text contrast holds at every hue.
 *
 * OKLCH is emitted directly: every browser that can run a modern preview
 * supports it, and keeping the maths in a perceptual space is what stops the
 * muddy mid-tones that give AI output away.
 */

import { pick, pickFloat, pickInt } from "./seed";

export const HARMONIES = [
  "monochrome",
  "analogous",
  "complementary",
  "split",
  "duotone",
  "triad",
] as const;
export type Harmony = (typeof HARMONIES)[number];

export interface Palette {
  /** Light or dark as the *primary* presentation. */
  scheme: "light" | "dark";
  harmony: Harmony;
  /** Hue anchor in degrees, 0-359. */
  hue: number;
  tokens: PaletteTokens;
}

export interface PaletteTokens {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  secondary: string;
  highlight: string;
}

function oklch(l: number, c: number, h: number): string {
  const lightness = Math.round(Math.min(1, Math.max(0, l)) * 1000) / 10;
  const chroma = Math.round(Math.max(0, c) * 1000) / 1000;
  const hue = (((Math.round(h * 10) / 10) % 360) + 360) % 360;
  return `oklch(${lightness}% ${chroma} ${hue})`;
}

function rotate(hue: number, degrees: number): number {
  return (((hue + degrees) % 360) + 360) % 360;
}

/** Where the secondary hue sits, per harmony. */
function secondaryHue(hue: number, harmony: Harmony, random: () => number): number {
  switch (harmony) {
    case "monochrome":
      return hue;
    case "analogous":
      return rotate(hue, pickInt(18, 42, random) * (random() > 0.5 ? 1 : -1));
    case "complementary":
      return rotate(hue, 180);
    case "split":
      return rotate(hue, random() > 0.5 ? 150 : 210);
    case "duotone":
      return rotate(hue, pickInt(120, 200, random));
    case "triad":
      return rotate(hue, random() > 0.5 ? 120 : 240);
  }
}

export function buildPalette(options: {
  random: () => number;
  /** Force a scheme; otherwise it is part of the direction's identity. */
  scheme?: "light" | "dark";
  /** Force a hue anchor; otherwise seeded. */
  hue?: number;
  harmony?: Harmony;
  /** How saturated the accent is allowed to get. */
  intensity?: "quiet" | "measured" | "vivid";
}): Palette {
  const { random } = options;
  const scheme = options.scheme ?? (random() > 0.68 ? "dark" : "light");
  const harmony = options.harmony ?? pick(HARMONIES, random);
  // Hues are drawn away from the 250-275 band: that is the AI-default
  // indigo/violet every model reaches for first.
  const hue =
    options.hue ??
    (() => {
      const raw = pickInt(0, 359, random);
      return raw >= 248 && raw <= 278 ? rotate(raw, pickInt(40, 120, random)) : raw;
    })();
  const intensity = options.intensity ?? pick(["quiet", "measured", "vivid"] as const, random);

  const accentChroma =
    intensity === "quiet"
      ? pickFloat(0.05, 0.1, random)
      : intensity === "measured"
        ? pickFloat(0.11, 0.17, random)
        : pickFloat(0.18, 0.27, random);
  // Neutrals carry a trace of the anchor hue so greys feel designed rather
  // than lifted from a framework default.
  const neutralChroma = pickFloat(0.003, 0.016, random);
  const second = secondaryHue(hue, harmony, random);

  if (scheme === "dark") {
    const bgL = pickFloat(0.14, 0.21, random);
    const accentL = pickFloat(0.68, 0.8, random);
    return {
      scheme,
      harmony,
      hue,
      tokens: {
        bg: oklch(bgL, neutralChroma, hue),
        surface: oklch(bgL + 0.045, neutralChroma * 1.4, hue),
        surfaceAlt: oklch(bgL + 0.085, neutralChroma * 1.6, hue),
        text: oklch(pickFloat(0.93, 0.97, random), neutralChroma, hue),
        textMuted: oklch(pickFloat(0.66, 0.74, random), neutralChroma * 2, hue),
        border: oklch(bgL + pickFloat(0.1, 0.15, random), neutralChroma * 2, hue),
        accent: oklch(accentL, accentChroma, hue),
        accentText: oklch(0.16, neutralChroma, hue),
        accentSoft: oklch(bgL + 0.08, accentChroma * 0.4, hue),
        secondary: oklch(pickFloat(0.62, 0.76, random), accentChroma * 0.85, second),
        highlight: oklch(pickFloat(0.84, 0.92, random), accentChroma * 0.5, second),
      },
    };
  }

  const bgL = pickFloat(0.955, 0.995, random);
  const accentL = pickFloat(0.46, 0.62, random);
  return {
    scheme,
    harmony,
    hue,
    tokens: {
      bg: oklch(bgL, neutralChroma, hue),
      surface: oklch(bgL - pickFloat(0.015, 0.04, random), neutralChroma * 1.3, hue),
      surfaceAlt: oklch(bgL - pickFloat(0.05, 0.09, random), neutralChroma * 1.5, hue),
      text: oklch(pickFloat(0.15, 0.24, random), neutralChroma * 1.5, hue),
      textMuted: oklch(pickFloat(0.46, 0.56, random), neutralChroma * 2.5, hue),
      border: oklch(bgL - pickFloat(0.1, 0.17, random), neutralChroma * 2.5, hue),
      accent: oklch(accentL, accentChroma, hue),
      accentText: oklch(0.985, 0.002, hue),
      accentSoft: oklch(bgL - 0.03, accentChroma * 0.35, hue),
      secondary: oklch(pickFloat(0.4, 0.58, random), accentChroma * 0.9, second),
      highlight: oklch(pickFloat(0.86, 0.94, random), accentChroma * 0.55, second),
    },
  };
}

/** The palette as a copy-pasteable CSS custom-property block. */
export function paletteCss(palette: Palette): string {
  const entries = Object.entries(palette.tokens).map(
    ([name, value]) =>
      `  --${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}: ${value};`
  );
  return `:root {\n${entries.join("\n")}\n}`;
}
