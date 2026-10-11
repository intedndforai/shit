import { getSetting, setSetting } from "@/lib/server/settings";

/**
 * Profile and preferences: who the user is and how the assistant should behave.
 * These instructions are applied to every chat that does not override them.
 */

export interface Profile {
  name: string;
  role: string;
  instructions: string;
}

export const DEFAULT_PROFILE: Profile = { name: "", role: "", instructions: "" };

export function readProfile(): Profile {
  const stored = getSetting<Partial<Profile>>("profile");
  return { ...DEFAULT_PROFILE, ...(stored ?? {}) };
}

export function writeProfile(patch: Partial<Profile>): Profile {
  const next = { ...readProfile(), ...patch };
  setSetting("profile", next);
  return next;
}

/** The system-prompt block for the user's profile, or null when it is empty. */
export function profileInstructions(): string | null {
  const profile = readProfile();
  const lines: string[] = [];
  if (profile.name.trim()) lines.push(`The user's name is ${profile.name.trim()}.`);
  if (profile.role.trim()) lines.push(`They work as: ${profile.role.trim()}.`);
  if (profile.instructions.trim()) lines.push(`How they want you to respond: ${profile.instructions.trim()}`);
  return lines.length ? lines.join(" ") : null;
}