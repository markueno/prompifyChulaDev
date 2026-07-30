import type { Message } from 'ai';
import { createScopedLogger } from '~/utils/logger';
import type { ChatHistoryItem } from './useChatHistory';

export interface IChatMetadata {
  gitUrl: string;
  gitBranch?: string;
  netlifySiteId?: string;
}

const logger = createScopedLogger('ChatHistory');

// this is used at the top level and never rejects
export async function openDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') {
    console.error('indexedDB is not available in this environment.');
    return undefined;
  }

  return new Promise(resolve => {
    /*
     * v2 (Day 8): adds the `snapshots` store for content-addressed codebase restore.
     * v3 (Day 10): adds `pendingWrites` for offline outbox (failed saves queued, drained on reconnect).
     */
    const request = indexedDB.open('boltHistory', 3);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains('chats')) {
        const store = db.createObjectStore('chats', { keyPath: 'id' });
        store.createIndex('id', 'id', { unique: true });
        store.createIndex('urlId', 'urlId', { unique: true });
      }

      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'chatId' });
      }

      if (!db.objectStoreNames.contains('pendingWrites')) {
        db.createObjectStore('pendingWrites', { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('counters')) {
        db.createObjectStore('counters', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      resolve(undefined);
      logger.error((event.target as IDBOpenDBRequest).error);
    };
  });
}

export async function getAll(db: IDBDatabase): Promise<ChatHistoryItem[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as ChatHistoryItem[]);
    request.onerror = () => reject(request.error);
  });
}

export async function setMessages(
  db: IDBDatabase,
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
  timestamp?: string,
  metadata?: IChatMetadata
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readwrite');
    const store = transaction.objectStore('chats');

    if (timestamp && isNaN(Date.parse(timestamp))) {
      reject(new Error('Invalid timestamp'));
      return;
    }

    const request = store.put({
      id,
      messages,
      urlId,
      description,
      timestamp: timestamp ?? new Date().toISOString(),
      metadata,
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getMessages(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return (await getMessagesById(db, id)) || (await getMessagesByUrlId(db, id));
}

export async function getMessagesByUrlId(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const index = store.index('urlId');
    const request = index.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

export async function getMessagesById(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteById(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readwrite');
    const store = transaction.objectStore('chats');
    const request = store.delete(id);

    request.onsuccess = () => resolve(undefined);
    request.onerror = () => reject(request.error);
  });
}

/**
 * A locally-cached codebase snapshot (Day 8). Holds the full file content for the latest
 * version of a chat so the IDE can restore instantly without a network round-trip (Tier 1).
 * Keyed by `chatId` in the `snapshots` object store.
 */
export interface StoredSnapshot {
  chatId: string;
  version: number | null;
  manifest: Record<string, string>;
  files: Record<string, string>;
  timestamp: string;
}

export async function getSnapshot(db: IDBDatabase, chatId: string): Promise<StoredSnapshot | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readonly');
    const store = transaction.objectStore('snapshots');
    const request = store.get(chatId);

    request.onsuccess = () => resolve(request.result as StoredSnapshot | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function setSnapshot(db: IDBDatabase, snapshot: StoredSnapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readwrite');
    const store = transaction.objectStore('snapshots');
    const request = store.put(snapshot);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export interface PendingWrite {
  id?: number;
  type: string;
  chatId: string;
  payload: any;
  timestamp: number;
  retryCount: number;
}

export async function queueWrite(db: IDBDatabase, type: string, chatId: string, payload: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingWrites', 'readwrite');
    const store = tx.objectStore('pendingWrites');
    const request = store.put({
      type,
      chatId,
      payload,
      timestamp: Date.now(),
      retryCount: 0,
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingWrites(db: IDBDatabase): Promise<PendingWrite[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingWrites', 'readonly');
    const store = tx.objectStore('pendingWrites');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as PendingWrite[]);
    request.onerror = () => reject(request.error);
  });
}

export async function deletePendingWrite(db: IDBDatabase, id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingWrites', 'readwrite');
    const store = tx.objectStore('pendingWrites');
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function updatePendingWriteRetryCount(db: IDBDatabase, id: number, retryCount: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingWrites', 'readwrite');
    const store = tx.objectStore('pendingWrites');
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const existing = getReq.result;

      if (existing) {
        existing.retryCount = retryCount;

        const putReq = store.put(existing);
        putReq.onsuccess = () => (tx.oncomplete ? resolve() : resolve());
        putReq.onerror = () => reject(putReq.error);
      } else {
        resolve();
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function getNextId(_db: IDBDatabase): Promise<string> {
  /*
   * Chat ids are the PRIMARY KEY of the shared Postgres `chats` table across ALL users
   * (the client id is dual-written as the PG id). The old per-browser counter restarted at
   * "1" in every user's browser, so every user's first chat collided on id="1": the save
   * clobbered a single row (ON CONFLICT DO UPDATE) and data ops resolved to the wrong owner
   * (403 on import). A globally-unique id is collision-free. Ids are opaque everywhere — no
   * code parses them as sequential numbers — so a random id is a safe drop-in. The `counters`
   * object store is left intact (unused) so existing databases need no migration.
   */
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for non-secure contexts lacking crypto.randomUUID (still collision-resistant).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getUrlId(db: IDBDatabase, id: string): Promise<string> {
  const idList = await getUrlIds(db);
  const randomSuffix = () =>
    (Math.random() + 1).toString(36).slice(2, 7) + (Math.random() + 1).toString(36).slice(2, 7);

  // Always append a random suffix so URLs are unguessable
  let candidate = `${id}-${randomSuffix()}`;

  while (idList.includes(candidate)) {
    candidate = `${id}-${randomSuffix()}`;
  }

  return candidate;
}

async function getUrlIds(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const idList: string[] = [];

    const request = store.openCursor();

    request.onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (cursor) {
        idList.push(cursor.value.urlId);
        cursor.continue();
      } else {
        resolve(idList);
      }
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function forkChat(db: IDBDatabase, chatId: string, messageId: string): Promise<string> {
  const chat = await getMessages(db, chatId);

  if (!chat) {
    throw new Error('Chat not found');
  }

  // Find the index of the message to fork at
  const messageIndex = chat.messages.findIndex(msg => msg.id === messageId);

  if (messageIndex === -1) {
    throw new Error('Message not found');
  }

  // Get messages up to and including the selected message
  const messages = chat.messages.slice(0, messageIndex + 1);

  return createChatFromMessages(db, chat.description ? `${chat.description} (fork)` : 'Forked chat', messages);
}

export async function duplicateChat(db: IDBDatabase, id: string): Promise<string> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  return createChatFromMessages(db, `${chat.description || 'Chat'} (copy)`, chat.messages);
}

export async function createChatFromMessages(
  db: IDBDatabase,
  description: string,
  messages: Message[],
  metadata?: IChatMetadata
): Promise<string> {
  const newId = await getNextId(db);
  const newUrlId = await getUrlId(db, newId); // Get a new urlId for the duplicated chat

  await setMessages(
    db,
    newId,
    messages,
    newUrlId, // Use the new urlId
    description,
    undefined, // Use the current timestamp
    metadata
  );

  return newUrlId; // Return the urlId instead of id for navigation
}

export async function updateChatDescription(db: IDBDatabase, id: string, description: string): Promise<void> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  if (!description.trim()) {
    throw new Error('Description cannot be empty');
  }

  await setMessages(db, id, chat.messages, chat.urlId, description, chat.timestamp, chat.metadata);
}

export async function updateChatMetadata(
  db: IDBDatabase,
  id: string,
  metadata: IChatMetadata | undefined
): Promise<void> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  await setMessages(db, id, chat.messages, chat.urlId, chat.description, chat.timestamp, metadata);
}
