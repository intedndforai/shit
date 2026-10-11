"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const ACCENTS = ["amber", "rose", "teal", "indigo"] as const;
export type Accent = (typeof ACCENTS)[number];

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
  accent: Accent;
  /* Overlays */
  searchOpen: boolean;
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
  /* Actions */
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setAccent: (accent: Accent) => void;
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
      accent: "amber",
      searchOpen: false,
      artifactsOpen: false,
      composerDraft: "",
      attachments: [],
      pendingTools: null,
      toolRuns: {},
      pendingModelId: null,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      setAccent: (accent) => set({ accent }),
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
      }),
    }
  )
);