"use client";

import * as React from "react";
import { KeyRound, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChatStore } from "@/lib/store/chat-store";

/**
 * Block-and-ask dialog for the privacy gate and detected credentials
 * (Sections 3.4, 3.6, 3.14). Overrides are one-time: the next send is gated
 * again unless the user changes the mode or the provider policy.
 */
export function PrivacyBlockDialog() {
  const block = useChatStore((state) => state.privacyBlock);
  const clear = useChatStore((state) => state.clearPrivacyBlock);
  const retry = useChatStore((state) => state.retryPrivacyOverride);
  const [busy, setBusy] = React.useState(false);

  const isCredentials = block?.code === "credentials";
  const canOverride = block?.code !== "strict-local";

  const override = async () => {
    if (!block) return;
    setBusy(true);
    try {
      await retry(
        isCredentials ? { allowCredentials: true } : { allowPolicyOnce: true }
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(block)} onOpenChange={(open) => !open && clear()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCredentials ? <KeyRound className="size-4" /> : <ShieldAlert className="size-4" />}
            {isCredentials ? "Credential detected" : "Blocked by your privacy settings"}
          </DialogTitle>
          <DialogDescription>{block?.message}</DialogDescription>
        </DialogHeader>

        {block?.credentials?.length ? (
          <ul className="flex flex-col gap-1 text-xs">
            {block.credentials.map((item) => (
              <li key={item.placeholder + item.preview} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
                <span className="font-mono">{item.kind}</span>
                <span className="font-mono text-muted-foreground">{item.preview}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {block?.gate?.reasons?.length ? (
          <ul className="list-disc pl-4 text-xs text-muted-foreground">
            {block.gate.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        <p className="text-[11px] text-muted-foreground">
          This override applies to this turn only. Change the privacy mode or the provider&apos;s
          declared policy to stop seeing this prompt.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={clear} disabled={busy}>
            Cancel
          </Button>
          {canOverride ? (
            <Button onClick={() => void override()} disabled={busy}>
              {busy ? "Sending…" : isCredentials ? "Allow once and send" : "Send once anyway"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
