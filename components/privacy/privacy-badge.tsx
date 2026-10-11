"use client";

import * as React from "react";
import { Building2, EyeOff, HardDrive, ShieldCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PRIVACY_MODE_INFO, type PrivacyMode } from "@/lib/privacy/types";
import { cn } from "@/lib/utils";

export interface BadgeDestination {
  /** "local" when the endpoint is loopback/private; "provider" otherwise. */
  kind: "provider" | "local" | "unknown";
  label: string;
  host?: string;
}

const ICONS: Record<PrivacyMode, React.ComponentType<{ className?: string }>> = {
  standard: Building2,
  private: ShieldCheck,
  incognito: EyeOff,
  local: HardDrive,
};

/**
 * Reusable destination + mode badge (Section 5). Shown in the composer and the
 * chat header. The policy text is always worded as user-declared — Conduit can
 * not verify a provider's behaviour.
 */
export function PrivacyBadge({
  mode,
  destination,
  policyLabel,
  className,
}: {
  mode: PrivacyMode;
  destination?: BadgeDestination;
  policyLabel?: string | null;
  className?: string;
}) {
  const info = PRIVACY_MODE_INFO[mode];
  const Icon = ICONS[mode];
  const detail = destination
    ? destination.kind === "local"
      ? `Local endpoint: ${destination.host ?? destination.label}`
      : `Provider: ${destination.label}${destination.host ? ` (${destination.host})` : ""}`
    : "No destination resolved yet";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[11px] text-muted-foreground",
            mode === "private" && "border-accent/40 text-foreground",
            mode === "local" && "border-emerald-500/40 text-foreground",
            className
          )}
        >
          <Icon className="size-3 shrink-0" aria-hidden />
          <span className="shrink-0 font-medium text-foreground">{info.label}</span>
          {policyLabel ? (
            <span className="min-w-0 truncate">· {policyLabel}</span>
          ) : destination ? (
            <span className="min-w-0 truncate">· {destination.label}</span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-medium">{info.summary}</p>
        <p className="mt-1 text-xs">{info.detail}</p>
        <p className="mt-1 text-xs">{detail}</p>
        {policyLabel ? (
          <p className="mt-1 text-xs">
            {policyLabel} — user-declared, not verified by Conduit.
          </p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
