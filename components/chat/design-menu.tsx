"use client";

import * as React from "react";
import { Check, Compass, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DIRECTIONS } from "@/lib/craft/directions";
import { useUIStore } from "@/lib/store/ui-store";

/**
 * The art-direction control.
 *
 * "Auto" lets the server decide from the request whether this turn is design
 * work; "On" forces the full craft brief for every turn; "Off" never attaches
 * it. A specific direction can be pinned instead of letting the seed choose —
 * useful when you want to compare two looks or stay in one tradition.
 */
export function DesignMenu() {
  const designMode = useUIStore((state) => state.designMode);
  const designDirection = useUIStore((state) => state.designDirection);
  const setDesignMode = useUIStore((state) => state.setDesignMode);
  const setDesignDirection = useUIStore((state) => state.setDesignDirection);

  const direction = designDirection
    ? DIRECTIONS.find((entry) => entry.slug === designDirection)
    : null;
  const active = designMode === "on" || designDirection !== null;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant={active ? "accent" : "ghost"}
              size="icon-sm"
              aria-label="Art direction"
              aria-pressed={active}
            >
              <Palette className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {direction
            ? `Art direction: ${direction.name}`
            : "Art direction — brief the model before it designs"}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel className="text-xs">
          Art direction
          <p className="mt-0.5 font-normal text-[11px] text-muted-foreground">
            Attaches a real design brief — typography, palette, layout, and the banned defaults — so
            generated pages stop looking generated.
          </p>
        </DropdownMenuLabel>

        <DropdownMenuRadioGroup
          value={designMode}
          onValueChange={(value) => setDesignMode(value as "auto" | "on" | "off")}
        >
          <DropdownMenuRadioItem value="auto">
            <span className="flex flex-col">
              <span>Auto</span>
              <span className="text-[11px] text-muted-foreground">
                Attach the brief when the turn is design work
              </span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="on">
            <span className="flex flex-col">
              <span>Always</span>
              <span className="text-[11px] text-muted-foreground">
                Brief every turn in this chat
              </span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="off">
            <span className="flex flex-col">
              <span>Off</span>
              <span className="text-[11px] text-muted-foreground">Never attach the brief</span>
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-xs">
          Direction
          <p className="mt-0.5 font-normal text-[11px] text-muted-foreground">
            Leave it to the seed, or pin one tradition.
          </p>
        </DropdownMenuLabel>

        <DropdownMenuRadioGroup
          value={designDirection ?? "auto"}
          onValueChange={(value) => setDesignDirection(value === "auto" ? null : value)}
        >
          <DropdownMenuRadioItem value="auto">
            <Compass className="size-3.5" />
            <span className="flex-1">Let the seed decide</span>
          </DropdownMenuRadioItem>
          {DIRECTIONS.map((entry) => (
            <DropdownMenuRadioItem key={entry.slug} value={entry.slug}>
              <Check className="size-3.5 opacity-0" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{entry.name}</span>
                <span className="truncate text-[11px] text-muted-foreground">{entry.summary}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
