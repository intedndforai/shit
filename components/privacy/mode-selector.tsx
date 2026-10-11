"use client";

import * as React from "react";
import { useChatStore } from "@/lib/store/chat-store";
import { PRIVACY_MODE_INFO, privacyModes, type PrivacyMode } from "@/lib/privacy/types";

const SELECT_CLASS =
  "h-7 rounded-md border border-border bg-background px-1.5 text-xs outline-none focus-visible:border-accent/70";

/**
 * Per-chat privacy mode picker (Section 3.3). Every mode changes real behavior
 * in the chat route: Standard, Private (redaction + policy gate), Incognito
 * (nothing persisted), and Strict Local (local endpoints only).
 */
export function PrivacyModeSelector() {
  const chatId = useChatStore((state) => state.chatId);
  const mode = useChatStore((state) => state.chatPrivacyMode);
  const updateChatMeta = useChatStore((state) => state.updateChatMeta);

  if (!chatId) return null;

  return (
    <label className="flex min-w-0 items-center gap-1.5">
      <span className="sr-only">Privacy mode</span>
      <select
        className={SELECT_CLASS}
        value={mode}
        aria-label="Privacy mode"
        title={PRIVACY_MODE_INFO[mode].detail}
        onChange={(event) => void updateChatMeta({ privacyMode: event.target.value as PrivacyMode })}
      >
        {privacyModes.map((value) => (
          <option key={value} value={value}>
            {PRIVACY_MODE_INFO[value].label}
          </option>
        ))}
      </select>
    </label>
  );
}
