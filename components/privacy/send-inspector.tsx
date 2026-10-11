"use client";

import * as React from "react";
import { ScanEye, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { api, type SendPreviewDto } from "@/lib/api-client";
import { PRIVACY_MODE_INFO, type PrivacyMode } from "@/lib/privacy/types";
import { cn } from "@/lib/utils";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] text-right">{value}</span>
    </div>
  );
}

function egressText(egress: { kind: string; destination?: string }): string {
  if (egress.kind === "none") return "No egress";
  if (egress.kind === "local") return "Runs locally";
  return `Third party: ${egress.destination ?? "unknown destination"}`;
}

/**
 * "What will be sent" inspector (Section 3.5). Shows the destination, model,
 * policy, message counts, attachments, memory, tools, and the redactions that
 * would be applied. Metadata and a payload hash only — never the prompt text.
 */
export function SendInspector({ buildRequest }: { buildRequest: () => Record<string, unknown> }) {
  const [open, setOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<SendPreviewDto | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { preview: result } = await api.sendPreview(buildRequest());
      setPreview(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not build the preview.");
    } finally {
      setLoading(false);
    }
  }, [buildRequest]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="What will be sent">
          <ScanEye className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>What will be sent</DialogTitle>
          <DialogDescription>
            A preview of this turn before you send it. Conduit shows metadata and a fingerprint of the
            payload — never a second copy of your content.
          </DialogDescription>
        </DialogHeader>

        {loading ? <p className="text-sm text-muted-foreground">Checking the request…</p> : null}
        {error ? (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}

        {preview && !loading ? (
          <div className="flex flex-col gap-2 text-sm">
            <Row
              label="Mode"
              value={PRIVACY_MODE_INFO[preview.mode as PrivacyMode]?.label ?? preview.mode}
            />
            <Row
              label="Destination"
              value={
                preview.destination.kind === "local"
                  ? `Local endpoint (${preview.destination.host})`
                  : `${preview.destination.label} (${preview.destination.host})`
              }
            />
            <Row label="Model" value={preview.model} />
            <Row
              label="Provider policy"
              value={
                <span>
                  {preview.policy.training} training · {preview.policy.retention} retention
                  <span className="block text-[11px] text-muted-foreground">user-declared, not verified</span>
                </span>
              }
            />
            <Row
              label="Messages"
              value={`${preview.messages.count} (${Object.entries(preview.messages.roles)
                .map(([role, count]) => `${count} ${role}`)
                .join(", ")})`}
            />
            <Row label="Approx. input" value={`~${preview.approxInputTokens.toLocaleString()} tokens`} />
            <Row
              label="Attachments"
              value={
                preview.attachments.length
                  ? preview.attachments.map((item) => `${item.name} (${item.kind}, ${item.size} B)`).join(", ")
                  : "None"
              }
            />
            <Row label="Memory" value={preview.memory.included ? `${preview.memory.items} item(s) included` : "Not included"} />
            <Row
              label="Tools offered"
              value={
                preview.tools.length ? (
                  <span className="flex flex-col items-end gap-1">
                    {preview.tools.map((tool) => (
                      <span key={tool.name} className="block">
                        {tool.label}
                        <span className="block text-[11px] text-muted-foreground">{egressText(tool.egress)}</span>
                      </span>
                    ))}
                  </span>
                ) : (
                  "None"
                )
              }
            />
            <Separator />
            <Row
              label="Redactions"
              value={
                preview.redactions.applied ? (
                  <span className="flex flex-col items-end gap-1">
                    {preview.redactions.items.map((item) => (
                      <span key={item.placeholder} className="block font-mono text-xs">
                        {item.placeholder} · {item.preview}
                        {item.credential ? " (credential)" : ""}
                      </span>
                    ))}
                  </span>
                ) : (
                  "None applied"
                )
              }
            />
            <Row
              label="Payload fingerprint"
              value={<span className="font-mono text-[11px]">{preview.payloadHash.slice(0, 16)}…</span>}
            />
            {!preview.gate.allowed ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                <p className="font-medium">The privacy gate would block this send.</p>
                <ul className="mt-1 list-disc pl-4">
                  {preview.gate.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="mt-1 flex flex-col gap-1 text-[11px] text-muted-foreground">
              {preview.notes.map((note) => (
                <p key={note} className={cn(note.includes("cannot verify") && "text-amber-600 dark:text-amber-500")}>
                  {note}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
