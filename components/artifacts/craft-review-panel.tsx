"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Send, ShieldAlert, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, type CraftFinding, type CraftReviewDto, type CraftSeverity } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Craft review.
 *
 * The findings come from the same detector the server uses, so what the user
 * sees here is exactly what would be sent back to the model. Nothing is
 * submitted automatically: "Send the brief" drops the revision brief into the
 * composer, where the user can read it and edit it first.
 */

const SEVERITY_STYLE: Record<CraftSeverity, { label: string; className: string }> = {
  critical: {
    label: "Critical",
    className: "border-destructive/50 bg-destructive/10 text-destructive",
  },
  high: {
    label: "High",
    className: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  medium: { label: "Medium", className: "border-border bg-secondary text-foreground" },
  low: { label: "Low", className: "border-border bg-transparent text-muted-foreground" },
};

const GRADE_STYLE: Record<CraftReviewDto["grade"], string> = {
  exceptional: "text-emerald-600 dark:text-emerald-400",
  solid: "text-foreground",
  generic: "text-amber-600 dark:text-amber-500",
  slop: "text-destructive",
};

function FindingCard({ finding }: { finding: CraftFinding }) {
  const style = SEVERITY_STYLE[finding.severity];
  const [open, setOpen] = React.useState(
    finding.severity === "critical" || finding.severity === "high"
  );

  return (
    <li className="rounded-lg border border-border bg-background">
      <button
        type="button"
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Badge
          variant="outline"
          className={cn("mt-0.5 shrink-0 border text-[10px]", style.className)}
        >
          {style.label}
        </Badge>
        <span className="min-w-0 flex-1 text-xs font-medium">{finding.title}</span>
        {finding.count > 1 ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">×{finding.count}</span>
        ) : null}
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 px-2.5 pb-2.5 text-[11px]">
          <p className="text-muted-foreground">{finding.why}</p>
          <p className="rounded-md bg-secondary/60 px-2 py-1.5">
            <span className="font-medium text-foreground">Instead: </span>
            {finding.fix}
          </p>
          {finding.at.length ? (
            <p className="font-mono text-[10px] text-muted-foreground">{finding.at.join(", ")}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function CraftReviewPanel({
  artifactId,
  onSendBrief,
  className,
}: {
  artifactId: string;
  /** Hands the revision brief to the composer without sending it. */
  onSendBrief: (brief: string) => void;
  className?: string;
}) {
  const [loading, setLoading] = React.useState(false);
  // Each artifact version is its own review; state is keyed by artifact id so a
  // switch swaps stale state out during render instead of in an effect.
  const [reviewState, setReviewState] = React.useState<{
    id: string;
    review: CraftReviewDto | null;
    error: string | null;
  }>({
    id: artifactId,
    review: null,
    error: null,
  });
  if (reviewState.id !== artifactId) setReviewState({ id: artifactId, review: null, error: null });
  const review = reviewState.id === artifactId ? reviewState.review : null;
  const error = reviewState.id === artifactId ? reviewState.error : null;

  const run = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.reviewArtifact(artifactId);
      setReviewState({ id: artifactId, review: result.review, error: null });
    } catch (cause) {
      setReviewState({
        id: artifactId,
        review: null,
        error: cause instanceof Error ? cause.message : "Could not review this artifact.",
      });
    } finally {
      setLoading(false);
    }
  }, [artifactId]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void run()} disabled={loading}>
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {review ? "Re-run review" : "Review design"}
        </Button>
        {review ? (
          <span className="flex items-baseline gap-1.5 text-xs">
            <span className={cn("text-lg font-semibold tabular-nums", GRADE_STYLE[review.grade])}>
              {review.score}
            </span>
            <span className="text-muted-foreground">/100 · {review.grade}</span>
          </span>
        ) : null}
        {review && review.findings.length && review.brief ? (
          <Button size="sm" className="ml-auto" onClick={() => onSendBrief(review.brief)}>
            <Send className="size-3.5" />
            Send the brief
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {!review && !loading && !error ? (
        <p className="text-xs text-muted-foreground">
          Checks the output for the tells of unedited AI design — the default violet gradient, the{" "}
          <code className="rounded bg-secondary px-1">&apos;Segoe UI&apos;, Tahoma</code> font
          stack, lorem ipsum, emoji feature icons, CDN dependencies — plus the craft and
          accessibility basics. Nothing is sent to a model unless you send the brief.
        </p>
      ) : null}

      {review && !review.findings.length ? (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          {review.summary}
        </p>
      ) : null}

      {review && review.findings.length ? (
        <>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            {review.grade === "slop" || review.grade === "generic" ? (
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            ) : (
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            )}
            {review.summary}
          </p>
          <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto pr-1">
            {review.findings.map((finding) => (
              <FindingCard key={finding.id} finding={finding} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
