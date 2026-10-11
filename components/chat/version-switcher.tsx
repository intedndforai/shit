"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** "< 2/3 >" branch switcher shown when a turn has sibling versions. */
export function VersionSwitcher({
  index,
  count,
  onPrev,
  onNext,
}: {
  index: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (count <= 1) return null;

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-border px-1 py-0.5 text-[11px] text-muted-foreground">
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-5"
        aria-label="Previous version"
        disabled={index <= 0}
        onClick={onPrev}
      >
        <ChevronLeft className="size-3" />
      </Button>
      <span aria-live="polite">
        {index + 1}/{count}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-5"
        aria-label="Next version"
        disabled={index >= count - 1}
        onClick={onNext}
      >
        <ChevronRight className="size-3" />
      </Button>
    </div>
  );
}