"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const ACCENTS = ["amber", "rose", "teal", "indigo"] as const;
export type Accent = (typeof ACCENTS)[number];

interface UIState {
  /* Layout */
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  /* Appearance */
  accent: Accent;
  /* Composer */
  composerDraft: string;
  /* Actions */
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setAccent: (accent: Accent) => void;
  setComposerDraft: (draft: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      accent: "amber",
      composerDraft: "",
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      setAccent: (accent) => set({ accent }),
      setComposerDraft: (composerDraft) => set({ composerDraft }),
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