"use client";

import { Check } from "lucide-react";
import { ACCENTS, useUIStore, type Accent } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

const ACCENT_STYLES: Record<Accent, string> = {
  amber: "bg-[oklch(0.70_0.145_62)]",
  rose: "bg-[oklch(0.64_0.16_15)]",
  teal: "bg-[oklch(0.60_0.11_190)]",
  indigo: "bg-[oklch(0.56_0.17_275)]",
};

const ACCENT_LABELS: Record<Accent, string> = {
  amber: "Amber",
  rose: "Rose",
  teal: "Teal",
  indigo: "Indigo",
};

export function AccentPicker() {
  const accent = useUIStore((state) => state.accent);
  const setAccent = useUIStore((state) => state.setAccent);

  return (
    <div role="radiogroup" aria-label="Accent color" className="flex items-center gap-2">
      {ACCENTS.map((option) => {
        const selected = accent === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={ACCENT_LABELS[option]}
            title={ACCENT_LABELS[option]}
            onClick={() => setAccent(option)}
            className={cn(
              "flex size-8 items-center justify-center rounded-full border transition-transform",
              selected ? "border-foreground/60 scale-105" : "border-transparent hover:scale-105"
            )}
          >
            <span className={cn("flex size-6 items-center justify-center rounded-full", ACCENT_STYLES[option])}>
              {selected ? <Check className="size-3.5 text-white" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}