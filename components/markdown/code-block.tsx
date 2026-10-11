"use client";

import * as React from "react";
import { Check, Copy, WrapText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Fenced code block: language label, copy button, and a line-wrap toggle.
 * Highlighting is applied by rehype-highlight before this component renders.
 */
export function CodeBlock({
  language,
  code,
  html,
  className,
}: {
  language?: string;
  code: string;
  html?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const [wrap, setWrap] = React.useState(false);

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
      <div className={cn("overflow-x-auto", wrap && "overflow-x-hidden")}>
        {html ? (
          <pre className={cn("p-3 text-[13px] leading-relaxed", wrap && "whitespace-pre-wrap break-words")}>
            <code
              className="hljs font-mono"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </pre>
        ) : (
          <pre className={cn("p-3 text-[13px] leading-relaxed", wrap && "whitespace-pre-wrap break-words")}>
            <code className="font-mono">{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}