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