"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { ChatView } from "@/components/chat/chat-view";
import { useChatStore } from "@/lib/store/chat-store";

/** Opens a stored conversation by id; the transcript streams in from the API. */
export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const openChat = useChatStore((state) => state.openChat);
  const currentId = useChatStore((state) => state.chatId);

  React.useEffect(() => {
    if (id && id !== currentId) {
      void openChat(id);
    }
  }, [currentId, id, openChat]);

  return <ChatView />;
}