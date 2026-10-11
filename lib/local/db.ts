"use client";

import Dexie, { type EntityTable } from "dexie";
import type { ContentPart, ChatRole } from "@/lib/db/schema";

/**
 * Local-only mode storage (IndexedDB via Dexie).
 *
 * When the user chooses "local-only", chats are persisted entirely in the
 * browser and never touch the server database. The entity shapes intentionally
 * mirror the Drizzle schema so syncing code stays trivial.
 *
 * M1 ships the store and versioning; the chat UI switches to it in M2.
 */

export interface LocalChat {
  id: string;
  title: string | null;
  systemPrompt: string | null;
  providerId: string | null;
  modelId: string | null;
  temperature: number;
  topP: number;
  maxTokens: number;
  pinned: 0 | 1;
  archived: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

export interface LocalMessage {
  id: string;
  chatId: string;
  parentId: string | null;
  branchIndex: number;
  role: ChatRole;
  content: ContentPart[];
  createdAt: number;
}

export interface LocalSetting {
  key: string;
  value: unknown;
  updatedAt: number;
}

class ConduitLocalDatabase extends Dexie {
  chats!: EntityTable<LocalChat, "id">;
  messages!: EntityTable<LocalMessage, "id">;
  settings!: EntityTable<LocalSetting, "key">;

  constructor() {
    super("conduit-local");
    this.version(1).stores({
      chats: "id, updatedAt, pinned, archived",
      messages: "id, chatId, parentId, createdAt",
      settings: "key",
    });
  }
}

let instance: ConduitLocalDatabase | null = null;

/** Lazily create the database so server rendering never touches IndexedDB. */
export function getLocalDb(): ConduitLocalDatabase {
  if (typeof window === "undefined") {
    throw new Error("Local-only storage is only available in the browser.");
  }
  if (!instance) {
    instance = new ConduitLocalDatabase();
  }
  return instance;
}