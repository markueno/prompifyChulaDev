/*
 * Cross-device history: proves the sidebar's server-backed listing and the one-shot back-fill
 * behave. The back-fill is the risky half — it re-mints legacy per-browser chat ids ("1", "2")
 * that collide across users, and it must not re-upload chats the server already has, so those
 * two properties are asserted rather than eyeballed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDatabase, getAll, setMessages, queueChatWrite, queueWrite, getPendingWrites } from './db';
import { backfillLocalOnlyChats, mapServerChat } from './chatSync';
import type { ChatHistoryItem } from './useChatHistory';

function localChat(overrides: Partial<ChatHistoryItem> = {}): ChatHistoryItem {
  return {
    id: 'local-1',
    urlId: 'local-url',
    description: 'A local chat',
    messages: [{ id: 'm1', role: 'user', content: 'hi' }] as ChatHistoryItem['messages'],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('mapServerChat', () => {
  it('maps snake_case server rows onto the sidebar shape', () => {
    const mapped = mapServerChat({
      id: 'abc',
      url_id: 'my-url',
      description: 'Server chat',
      messages: [],
      updated_at: '2026-08-01T10:00:00.000Z',
    });

    expect(mapped.urlId).toBe('my-url');
    expect(mapped.timestamp).toBe('2026-08-01T10:00:00.000Z');
  });

  it('substitutes a valid timestamp when the server sends an unparseable one', () => {
    // setMessages rejects an invalid timestamp, which would break the whole cache write.
    const mapped = mapServerChat({ id: 'abc', updated_at: 'not-a-date' });
    expect(Number.isNaN(Date.parse(mapped.timestamp))).toBe(false);
  });
});

describe('queueChatWrite', () => {
  let db: IDBDatabase;

  beforeEach(async () => {
    indexedDB = new IDBFactory();
    db = (await openDatabase()) as IDBDatabase;
  });

  afterEach(() => {
    db?.close();
  });

  it('keeps only the latest queued write per chat', async () => {
    /*
     * storeMessageHistory re-runs every ~50ms while streaming, so an appending queue would grow
     * 20 entries a second whenever saves are failing.
     */
    await queueChatWrite(db, 'chat-a', { id: 'chat-a', messages: [1] });
    await queueChatWrite(db, 'chat-a', { id: 'chat-a', messages: [1, 2] });
    await queueChatWrite(db, 'chat-a', { id: 'chat-a', messages: [1, 2, 3] });

    const pending = await getPendingWrites(db);
    const forChatA = pending.filter(w => w.chatId === 'chat-a');

    expect(forChatA).toHaveLength(1);
    expect((forChatA[0].payload as { messages: number[] }).messages).toEqual([1, 2, 3]);
  });

  it('does not disturb other chats or snapshot writes', async () => {
    await queueWrite(db, 'version', 'chat-b', { manifest: {} });
    await queueChatWrite(db, 'chat-a', { id: 'chat-a' });
    await queueChatWrite(db, 'chat-a', { id: 'chat-a', again: true });

    const pending = await getPendingWrites(db);

    expect(pending.filter(w => w.type === 'version')).toHaveLength(1);
    expect(pending.filter(w => w.type === 'chat')).toHaveLength(1);
  });
});

describe('backfillLocalOnlyChats', () => {
  let db: IDBDatabase;

  beforeEach(async () => {
    indexedDB = new IDBFactory();
    db = (await openDatabase()) as IDBDatabase;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    db?.close();
  });

  it('pushes a local-only chat and leaves a UUID id alone', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const uuid = '1c130110-75e7-4657-afff-264869d20a0c';
    const result = await backfillLocalOnlyChats(db, [localChat({ id: uuid })], []);

    expect(result).toEqual({ pushed: 1, skipped: 0 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.id).toBe(uuid);
  });

  it('uploads a legacy per-browser id under a fresh UUID and drops the local record', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    // "1" is the pre-050f5f4 id format that collides across users.
    await setMessages(db, '1', [], 'legacy-url', 'Legacy chat', new Date().toISOString());

    const legacy = localChat({ id: '1', urlId: 'legacy-url', description: 'Legacy chat' });
    const result = await backfillLocalOnlyChats(db, [legacy], []);

    expect(result.pushed).toBe(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).id).toMatch(/^[0-9a-f-]{36}$/i);

    /*
     * The legacy record is removed rather than re-keyed in place: `chats` indexes urlId as
     * UNIQUE, so both copies cannot coexist. The caller re-caches from the server right after,
     * which restores it locally under the new id.
     */
    const stored = await getAll(db);
    expect(stored.find(c => c.id === '1')).toBeUndefined();
  });

  it('does not re-upload chats the server already has', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const chat = localChat({ id: 'server-known' });
    const result = await backfillLocalOnlyChats(db, [chat], [chat]);

    expect(result.pushed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips a chat the server rejects (e.g. url_id already taken) without throwing', async () => {
    // chats.url_id is globally UNIQUE, so a push can legitimately fail.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const result = await backfillLocalOnlyChats(db, [localChat()], []);
    expect(result).toEqual({ pushed: 0, skipped: 1 });
  });

  it('ignores drafts the sidebar would not show anyway', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const noDescription = localChat({ id: 'a', urlId: 'a-url', description: undefined });
    const noMessages = localChat({ id: 'b', urlId: 'b-url', messages: [] });

    const result = await backfillLocalOnlyChats(db, [noDescription, noMessages], []);

    expect(result.pushed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
