"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_CUSTOM_ACCENT, DEFAULT_CUSTOM_GLOW } from "@/lib/accent";

export const ACCENTS = ["amber", "rose", "teal", "indigo"] as const;
export type Accent = (typeof ACCENTS)[number];
/** The stored accent setting: one of the presets, or a user-defined colour. */
export type AccentSetting = Accent | "custom";
/** How the accent brief is attached: automatically, always, or never. */
export type DesignMode = "auto" | "on" | "off";

/** An attachment in the composer: optimistic while the upload is in flight. */
export interface DraftAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind?: string;
  text?: string;
  dataUrl?: string;
  url?: string;
  truncated?: boolean;
  /** Partial-extraction or safety note reported by the server. */
  note?: string;
  /** Server-assigned attachment id, once the upload succeeds. */
  serverId?: string;
  /** Upload completion 0-100 while the file is in flight. */
  progress?: number;
  /** Rough token count for the extracted content, for the chip label. */
  tokens?: number;
  status: "uploading" | "ready" | "error";
  error?: string;
}

/** A file a code run produced, handed to the browser as a data URL. */
export interface ToolRunFile {
  name: string;
  size: number;
  mime: string;
  dataUrl: string;
}

/** Live state for a tool the browser is executing (see lib/client/code-tools.ts). */
export interface ToolRunState {
  id: string;
  name: string;
  label: string;
  input: unknown;
  requiresApproval: boolean;
  /** Where the tool sends data, shown in the approval prompt (Section 3.10). */
  egress?: { kind: string; destination?: string; note?: string };
  /** "server" tools only need a decision; "client" tools run in the browser. */
  execution: "server" | "client";
  status: "approval" | "running" | "done" | "error" | "denied";
  stdout: string;
  stderr: string;
  note?: string;
  result?: string;
  figures: string[];
  files: ToolRunFile[];
  error?: string;
  durationMs?: number;
}

interface UIState {
  /* Layout */
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  /* Appearance */
  accent: AccentSetting;
  customAccent: string;
  customGlow: string;
  glowMode: "accent" | "custom";
  /* Art direction (chat) */
  designMode: DesignMode;
  /** A pinned direction slug, or null to let the seed decide. */
  designDirection: string | null;
  /* Overlays */
  searchOpen: boolean;
  shortcutsOpen: boolean;
  artifactsOpen: boolean;
  /* Composer */
  composerDraft: string;
  attachments: DraftAttachment[];
  /** Tool names selected for the next message (null = registry defaults). */
  pendingTools: string[] | null;
  /** Ephemeral state for browser-executed tool calls, keyed by tool call id. */
  toolRuns: Record<string, ToolRunState>;
  /** Model chosen with an @-mention; applied to the next turn. */
  pendingModelId: string | null;
  /** Deep Research toggle in the composer; applied to the next turn. */
  researchMode: boolean;
  /* Actions */
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setAccent: (accent: AccentSetting) => void;
  setCustomAccent: (hex: string) => void;
  setCustomGlow: (hex: string) => void;
  setGlowMode: (mode: "accent" | "custom") => void;
  setDesignMode: (mode: DesignMode) => void;
  setDesignDirection: (slug: string | null) => void;
  setShortcutsOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setArtifactsOpen: (open: boolean) => void;
  toggleArtifacts: () => void;
  setComposerDraft: (draft: string) => void;
  addAttachments: (attachments: DraftAttachment[]) => void;
  updateAttachment: (id: string, patch: Partial<DraftAttachment>) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setPendingTools: (tools: string[] | null) => void;
  setPendingModelId: (modelId: string | null) => void;
  setResearchMode: (on: boolean) => void;
  startToolRun: (run: ToolRunState) => void;
  patchToolRun: (id: string, patch: Partial<ToolRunState>) => void;
  removeToolRun: (id: string) => void;
  clearToolRuns: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
  shortcutsOpen: false,
      accent: "amber",
      customAccent: DEFAULT_CUSTOM_ACCENT,
      customGlow: DEFAULT_CUSTOM_GLOW,
      glowMode: "accent",
      designMode: "auto",
      designDirection: null,
      searchOpen: false,
      artifactsOpen: false,
      composerDraft: "",
      attachments: [],
      pendingTools: null,
      toolRuns: {},
      pendingModelId: null,
      researchMode: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      setAccent: (accent) => set({ accent }),
      setCustomAccent: (customAccent) => set({ customAccent }),
      setCustomGlow: (customGlow) => set({ customGlow }),
      setGlowMode: (glowMode) => set({ glowMode }),
      setDesignMode: (designMode) => set({ designMode }),
      setDesignDirection: (designDirection) => set({ designDirection }),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      setArtifactsOpen: (artifactsOpen) => set({ artifactsOpen }),
      toggleArtifacts: () => set((state) => ({ artifactsOpen: !state.artifactsOpen })),
      setComposerDraft: (composerDraft) => set({ composerDraft }),
      addAttachments: (attachments) => set((state) => ({ attachments: [...state.attachments, ...attachments] })),
      updateAttachment: (id, patch) =>
        set((state) => ({
          attachments: state.attachments.map((attachment) =>
            attachment.id === id ? { ...attachment, ...patch } : attachment
          ),
        })),
      removeAttachment: (id) =>
        set((state) => ({ attachments: state.attachments.filter((attachment) => attachment.id !== id) })),
      clearAttachments: () => set({ attachments: [] }),
      setPendingTools: (pendingTools) => set({ pendingTools }),
      setPendingModelId: (pendingModelId) => set({ pendingModelId }),
      setResearchMode: (researchMode) => set({ researchMode }),
      startToolRun: (run) => set((state) => ({ toolRuns: { ...state.toolRuns, [run.id]: run } })),
      patchToolRun: (id, patch) =>
        set((state) => {
          const current = state.toolRuns[id];
          if (!current) return state;
          return { toolRuns: { ...state.toolRuns, [id]: { ...current, ...patch } } };
        }),
      removeToolRun: (id) =>
        set((state) => {
          const next = { ...state.toolRuns };
          delete next[id];
          return { toolRuns: next };
        }),
      clearToolRuns: () => set({ toolRuns: {} }),
    }),
    {
      name: "conduit-ui",
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        accent: state.accent,
        customAccent: state.customAccent,
        customGlow: state.customGlow,
        glowMode: state.glowMode,
        designMode: state.designMode,
        designDirection: state.designDirection,
      }),
    }
  )
);