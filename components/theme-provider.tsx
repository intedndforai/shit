"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { useUIStore } from "@/lib/store/ui-store";

/**
 * Wraps the app in next-themes and keeps the user's accent color in sync with
 * the `data-accent` attribute used by the CSS design tokens.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const accent = useUIStore((state) => state.accent);

  React.useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      themes={["light", "dark", "contrast", "system"]}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}