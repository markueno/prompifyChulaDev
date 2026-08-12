/*
 * Cross-device chat history.
 *
 * Chats have always been saved per-user in Postgres (useChatHistory POSTs to /api/chats), but the
 * sidebar listed them from IndexedDB, which is per-browser. The result was that a user saw one set
 * of projects on their laptop and a different set on their phone. This module makes the server the
 * source of truth for the listing, keeps IndexedDB as an offline cache, and pushes up any chat
 * that only ever existed locally.
 */
import type { Message } from 'ai';
import { setMessages, deleteById } from './db';
import type { ChatHistoryItem } from './useChatHistory';
import type { IChatMetadata } from './db';

/** A row as `getChatsByUserPostgres` returns it (snake_case, straight from Postgres). */
interface ServerChatRow {
  id: string;
  url_id?: string | null;
  description?: string | null;
  messages?: Message[] | null;
  metadata?: IChatMetadata | null;
  updated_at?: string | null;
  created_at?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** localStorage key marking that this browser has already pushed its local-only chats. */
export const BACKFILL_DONE_KEY = 'bolt_backfill_done_for_user';

export function mapServerChat(row: ServerChatRow): ChatHistoryItem {
  const timestamp = row.updated_at ?? row.created_at ?? new Date().toISOString();

  return {
    id: row.id,
    urlId: row.url_id ?? undefined,
    description: row.description ?? undefined,
    messages: Array.isArray(row.messages) ? row.messages : [],
    // IndexedDB rejects an unparseable timestamp, and Postgres can hand back odd values.
    timestamp: Number.isNaN(Date.parse(timestamp)) ? new Date().toISOString() : new Date(timestamp).toISOString(),
    metadata: row.metadata ?? undefined,
  };
}

/**
 * The caller's own chats from the server. Returns null (rather than []) when the server can't be
 * reached, so callers can tell "no chats" apart from "offline" and fall back to the local cache.
 *
 * Note the default scope: /api/chats?scope=all exists for moderators, but the sidebar must never
 * request it or a moderator would see every user's history in their own list.
 */
export async function fetchServerChats(): Promise<ChatHistoryItem[] | null> {
  try {
    const res = await fetch('/api/chats');

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as { chats?: ServerChatRow[] };

    return (data.chats ?? []).map(mapServerChat);
  } catch {
    return null;
  }
}

/** Mirror the server list into IndexedDB so opening a chat stays instant and works offline. */
export async function cacheChatsLocally(db: IDBDatabase, items: ChatHistoryItem[]): Promise<void> {
  await Promise.all(
    items.map(item =>
      setMessages(db, item.id, item.messages, item.urlId, item.description, item.timestamp, item.metadata).catch(
        () => undefined
      )
    )
  );
}

/** POST one chat to the server. Returns false on any non-OK response. */
async function pushChat(item: ChatHistoryItem, id: string): Promise<boolean> {
  try {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        url_id: item.urlId,
        description: item.description,
        messages: item.messages,
        metadata: item.metadata,
      }),
    });

    return res.ok;
  } catch {
    return false;
  }
}

export interface BackfillResult {
  pushed: number;
  skipped: number;
}

/**
 * Push chats that exist only in this browser up to the server, so a project created on one device
 * stops being invisible on every other one.
 *
 * Two things make this less trivial than it looks:
 *  - Chats created before `050f5f4` have per-browser sequential ids ("1", "2", …) that collide
 *    across users. `saveChatPostgres` guards its upsert with `WHERE chats.user_id = EXCLUDED.user_id`,
 *    so pushing a colliding id silently does nothing. Any non-UUID id is therefore re-minted, and
 *    the local record is re-keyed to match once the push succeeds.
 *  - `chats.url_id` is globally UNIQUE, so a push can legitimately fail on a taken url_id. Those
 *    are counted as skipped rather than retried forever.
 */
export async function backfillLocalOnlyChats(
  db: IDBDatabase,
  localItems: ChatHistoryItem[],
  serverItems: ChatHistoryItem[]
): Promise<BackfillResult> {
  const serverIds = new Set(serverItems.map(c => c.id));
  const serverUrlIds = new Set(serverItems.map(c => c.urlId).filter(Boolean));

  // Only chats the sidebar would actually show, and only ones with real content.
  const candidates = localItems.filter(
    item =>
      item.urlId &&
      item.description &&
      item.messages?.length > 0 &&
      !serverIds.has(item.id) &&
      !serverUrlIds.has(item.urlId)
  );

  let pushed = 0;
  let skipped = 0;

  for (const item of candidates) {
    const needsNewId = !UUID_RE.test(item.id);
    const targetId = needsNewId ? crypto.randomUUID() : item.id;

    if (!(await pushChat(item, targetId))) {
      skipped++;
      continue;
    }

    pushed++;

    if (needsNewId) {
      /*
       * Drop the legacy local record. We can't just write the re-keyed one alongside it: the
       * `chats` store indexes urlId as UNIQUE, so a second record with the same urlId throws a
       * ConstraintError. The server now owns this chat, and the caller re-caches from the server
       * immediately afterwards, which re-creates it locally under the new id.
       */
      await deleteById(db, item.id).catch(() => undefined);
    }
  }

  return { pushed, skipped };
}

/** Payload shape for a queued chat save (see drainQueue's 'chat' case). */
export interface QueuedChatPayload {
  id: string;
  url_id?: string;
  projectId?: string;
  description?: string;
  messages: Message[];
  metadata?: IChatMetadata;
}
