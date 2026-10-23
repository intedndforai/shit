"use client";

import * as React from "react";
import { Check, ChevronDown, ChevronUp, Copy, WrapText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Blocks longer than this start collapsed; the footer button reveals the rest. */
const COLLAPSE_LINES = 18;

/**
 * Clipping for the collapsed body. `18 lines * leading-relaxed (1.625) * 13px`
 * plus the `p-3` padding — exact for the default type scale, and only a safety
 * net if a wrapped line turns out taller.
 */
const COLLAPSED_MAX_HEIGHT = "calc(18 * 1.625em + 1.5rem)";

/**
 * Fenced code block: language label, line count, copy button, and a line-wrap
 * toggle. Highlighting is applied by rehype-highlight before this component
 * renders, and reaches us as React elements (`<span class="hljs-*">`), which we
 * render directly so the stylesheet applies. Long blocks collapse to
 * `COLLAPSE_LINES` lines with an inline "Show all N lines" footer; copying
 * always sends the full source.
 */
export function CodeBlock({
  language,
  code,
  highlighted,
  className,
}: {
  language?: string;
  code: string;
  /** Highlighted React children for the `<code>` element, from rehype-highlight. */
  highlighted?: React.ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const [wrap, setWrap] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  const lineCount = React.useMemo(() => code.split("\n").length, [code]);
  const collapsible = lineCount > COLLAPSE_LINES;
  const collapsed = collapsible && !expanded;

  // Copy always uses `code`, never the collapsed visible subset.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className={cn("group/code my-3 overflow-hidden rounded-xl border border-border bg-card", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {language ?? "text"}
        </span>
        {lineCount >= 2 ? (
          <span className="font-mono text-[11px] tracking-wide text-muted-foreground">
            {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={wrap ? "Disable line wrap" : "Wrap long lines"}
            aria-pressed={wrap}
            onClick={() => setWrap((value) => !value)}
          >
            <WrapText className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Copy code" onClick={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
        </div>
      </div>
      <div
        className={cn("overflow-x-auto", wrap && "overflow-x-hidden")}
        style={collapsed ? { maxHeight: COLLAPSED_MAX_HEIGHT, overflowY: "hidden" } : undefined}
      >
        {highlighted !== undefined ? (
          <pre className={cn("p-3 text-[13px] leading-relaxed", wrap && "whitespace-pre-wrap break-words")}>
            <code className="hljs font-mono">{highlighted}</code>
          </pre>
        ) : (
          <pre className={cn("p-3 text-[13px] leading-relaxed", wrap && "whitespace-pre-wrap break-words")}>
            <code className="font-mono">
              {collapsed ? code.split("\n").slice(0, COLLAPSE_LINES).join("\n") : code}
            </code>
          </pre>
        )}
      </div>
      {collapsible ? (
        <div className="border-t border-border">
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-full rounded-none border-0 text-xs"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <>
                <ChevronUp className="size-3.5" />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown className="size-3.5" />
                Show all {lineCount} lines
              </>
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}