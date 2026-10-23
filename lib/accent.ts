export const DEFAULT_CUSTOM_ACCENT = "#2563eb";
export const DEFAULT_CUSTOM_GLOW = "#22d3ee";

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const int = Number.parseInt(full, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw.split("").map((c) => c + c).join("").toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  return null;
}

export function accentForeground(hex: string): string {
  const [r, g, b] = hexToRgb(normalizeHex(hex) ?? DEFAULT_CUSTOM_ACCENT);
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.45 ? "#000000" : "#ffffff";
}

export function accentSoft(hex: string, amount = 0.14): string {
  return `color-mix(in oklch, ${hex} ${Math.round(amount * 100)}%, transparent)`;
}

export function accentGlow(hex: string, amount = 0.45): string {
  return `color-mix(in oklch, ${hex} ${Math.round(amount * 100)}%, transparent)`;
}