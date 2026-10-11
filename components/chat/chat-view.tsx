"use client";

import * as React from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Composer } from "@/components/layout/composer";
import { EmptyState } from "@/components/layout/empty-state";
import { MessageList } from "@/components/chat/message-list";
import { ArtifactPanel } from "@/components/artifacts/artifact-panel";
import { useChatStore } from "@/lib/store/chat-store";

/** The conversation surface: empty state, transcript, composer, and errors. */
export function ChatView() {
  const messages = useChatStore((state) => state.messages);
  const streaming = useChatStore((state) => state.streaming);
  const error = useChatStore((state) => state.error);
  const loading = useChatStore((state) => state.loading);
  const send = useChatStore((state) => state.send);
  const stop = useChatStore((state) => state.stop);
  const regenerate = useChatStore((state) => state.regenerate);
  const loadChats = useChatStore((state) => state.loadChats);

  React.useEffect(() => {
    void loadChats();
  }, [loadChats]);

  const needsProvider = Boolean(error && /no model is configured/i.test(error));

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
      {messages.length === 0 && !loading ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EmptyState />
        </div>
      ) : (
        <MessageList messages={messages} onRegenerate={regenerate} />
      )}

      {error ? (
        <div className="mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          {needsProvider ? (
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link href="/settings">Open Settings</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      <Composer onSend={send} onStop={stop} streaming={streaming} />
      </div>
      <ArtifactPanel />
    </div>
  );
}