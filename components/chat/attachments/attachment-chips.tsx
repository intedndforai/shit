"use client";

import { FileSpreadsheet, FileText, Image as ImageIcon, Loader2, TriangleAlert, X } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { useUIStore, type DraftAttachment } from "@/lib/store/ui-store";

function iconFor(attachment: DraftAttachment) {
  if (attachment.kind === "image" || attachment.mime.startsWith("image/")) return ImageIcon;
  if (attachment.kind === "spreadsheet") return FileSpreadsheet;
  return FileText;
}

/** Attachment chips shown above the composer input. */
export function AttachmentChips() {
  const attachments = useUIStore((state) => state.attachments);
  const removeAttachment = useUIStore((state) => state.removeAttachment);

  if (!attachments.length) return null;

  return (
    <ul className="flex flex-wrap gap-1.5 px-3 pt-3" aria-label="Attachments">
      {attachments.map((attachment) => {
        const Icon = iconFor(attachment);
        const failed = attachment.status === "error";

        return (
          <li
            key={attachment.id}
            className={cn(
              "flex max-w-[15rem] items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
              failed ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-border bg-secondary/60"
            )}
            title={attachment.error ?? attachment.name}
          >
            {attachment.status === "uploading" ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            ) : failed ? (
              <TriangleAlert className="size-3.5 shrink-0" />
            ) : (
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 truncate">{attachment.name}</span>
            {attachment.truncated ? <span className="shrink-0 text-[10px] uppercase">trimmed</span> : null}
            <span className="shrink-0 text-[10px] text-muted-foreground">{formatBytes(attachment.size)}</span>
            <button
              type="button"
              onClick={() => removeAttachment(attachment.id)}
              aria-label={`Remove ${attachment.name}`}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}