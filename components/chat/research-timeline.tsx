"use client";

import * as React from "react";
import { Check, ChevronRight, Compass, Link2, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ResearchStepView {
  id: string;
  label: string;
  status: string;
  detail?: string;
}

export interface ResearchSourceView {
  title: string;
  url: string;
  snippet: string;
}

function StepIcon({ status }: { status: string }) {
  if (status === "running") return <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-accent" />;
  if (status === "error") return <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />;
  if (status === "skipped") return <Compass className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />;
  return <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />;
}

/**
 * The visible Deep Research timeline: what was planned, which searches ran, and
 * which pages were read, followed by the numbered sources the report cites.
 */
export function ResearchTimeline({
  steps,
  sources,
  streaming = false,
}: {
  steps: ResearchStepView[];
  sources?: ResearchSourceView[];
  streaming?: boolean;
}) {
  // Open while the research is running, collapsed once the answer is written.
  // `null` means "follow the stream", so the card needs no effect to settle.
  const [manualOpen, setManualOpen] = React.useState<boolean | null>(null);
  const open = manualOpen ?? Boolean(streaming);

  if (!steps.length && !sources?.length) return null;

  const failed = steps.filter((step) => step.status === "error").length;

  return (
    <div className="rounded-xl border border-border bg-secondary/25">
      <button
        type="button"
        onClick={() => setManualOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
      >
        <Compass className="size-3.5" />
        <span className="font-medium text-foreground">Deep Research</span>
        <span>
          {steps.length} step{steps.length === 1 ? "" : "s"}
          {failed ? ` · ${failed} failed` : ""}
          {sources?.length ? ` · ${sources.length} source${sources.length === 1 ? "" : "s"}` : ""}
        </span>
        <ChevronRight className={cn("ml-auto size-3.5 transition-transform", open && "rotate-90")} />
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
          <ol className="flex flex-col gap-1.5">
            {steps.map((step) => (
              <li key={step.id} className="flex gap-2 text-xs">
                <StepIcon status={step.status} />
                <span className="min-w-0 flex-1">
                  <span className="block">{step.label}</span>
                  {step.detail ? (
                    <span className="mt-0.5 block break-words text-[11px] text-muted-foreground">{step.detail}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>

          {sources?.length ? (
            <div className="border-t border-border pt-2">
              <p className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                <Link2 className="size-3" />
                Sources
              </p>
              <ol className="flex flex-col gap-1">
                {sources.map((source, index) => (
                  <li key={source.url} className="flex gap-1.5 text-xs">
                    <span className="text-muted-foreground">[{index + 1}]</span>
                    <span className="min-w-0 flex-1">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-accent hover:underline"
                        title={source.url}
                      >
                        {source.title || source.url}
                      </a>
                      {source.snippet ? (
                        <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">
                          {source.snippet}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}