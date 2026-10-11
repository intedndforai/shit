import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(input: Date | number): string {
  const date = typeof input === "number" ? new Date(input) : input;
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function greetingForHour(hour = new Date().getHours()): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform || navigator.userAgent);
}

export function shortcutLabel(keys: string): string {
  const mac = isMacPlatform();
  return keys
    .replace(/\bMod\b/g, mac ? "⌘" : "Ctrl")
    .replace(/\bShift\b/g, mac ? "⇧" : "Shift")
    .replace(/\bAlt\b/g, mac ? "⌥" : "Alt")
    .replace(/\bEnter\b/g, "↵")
    .replace(/\+/g, mac ? "" : "+");
}