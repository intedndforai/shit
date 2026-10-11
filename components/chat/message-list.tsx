"use client";

import * as React from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageItem } from "@/components/chat/message-item";
import type { UiMessage } from "@/lib/store/chat-store";

/**
 * Scrollable transcript with auto-scroll that pauses while the reader scrolls
 * up, plus a "jump to latest" affordance.
 */
export function MessageList({
  messages,
  onRegenerate,
}: {
  messages: UiMessage[];
  onRegenerate: () => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = React.useState(true);

  const scrollToBottom = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setPinned(true);
  }, []);

  React.useEffect(() => {
    if (pinned) scrollToBottom();
  }, [messages, pinned, scrollToBottom]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distance < 80);
  };

  const lastAssistantIndex = messages.reduce(
    (acc, message, index) => (message.role === "assistant" ? index : acc),
    -1
  );

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={containerRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.map((message, index) => (
            <MessageItem
              key={message.id}
              message={message}
              isLastAssistant={index === lastAssistantIndex}
              onRegenerate={onRegenerate}
            />
          ))}
          <div className="h-4" />
        </div>
      </div>

      {!pinned ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="pointer-events-auto shadow-soft"
            onClick={scrollToBottom}
          >
            <ArrowDown className="size-3.5" />
            Jump to latest
          </Button>
        </div>
      ) : null}
    </div>
  );
}