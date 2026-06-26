/*
 * R1 SAFETY GATE (IMPLEMENTATION-PLAN Day 8): proves the IndexedDB v1 -> v2 upgrade adds the
 * `snapshots` store WITHOUT dropping the existing `chats` store or its data. This is the single
 * most dangerous change in the plan (local chat-history loss), so it is asserted automatically,
 * not checked by hand.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDatabase, getAll, getSnapshot, setSnapshot } from './db';

// Build a v1 `boltHistory` exactly as the pre-Day-8 code did, then seed one chat row.
function seedV1(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('boltHistory', 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.createObjectStore('chats', { keyPath: 'id' });
      store.createIndex('id', 'id', { unique: true });
      store.createIndex('urlId', 'urlId', { unique: true });
    };

    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('chats', 'readwrite');
      tx.objectStore('chats').put({
        id: '1',
        urlId: 'seed-url',
        messages: [],
        description: 'seeded v1 chat',
        timestamp: new Date().toISOString(),
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };

    request.onerror = () => reject(request.error);
  });
}

describe('openDatabase v1 -> v2 upgrade', () => {
  beforeEach(() => {
    // Fresh in-memory IndexedDB per test.
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('preserves existing chats data and adds the snapshots store', async () => {
    await seedV1();

    const db = await openDatabase();
    expect(db).toBeDefined();
    expect(db!.version).toBe(2);
    expect(db!.objectStoreNames.contains('chats')).toBe(true);
    expect(db!.objectStoreNames.contains('snapshots')).toBe(true);

    const chats = await getAll(db!);
    expect(chats).toHaveLength(1);
    expect(chats[0].id).toBe('1');
    expect(chats[0].urlId).toBe('seed-url');
  });

  it('creates both stores from scratch when no prior DB exists', async () => {
    const db = await openDatabase();
    expect(db!.version).toBe(2);
    expect(db!.objectStoreNames.contains('chats')).toBe(true);
    expect(db!.objectStoreNames.contains('snapshots')).toBe(true);
  });

  it('round-trips a snapshot through the snapshots store', async () => {
    const db = await openDatabase();

    await setSnapshot(db!, {
      chatId: 'chat_abc',
      version: 3,
      manifest: { 'src/App.tsx': 'deadbeef' },
      files: { 'src/App.tsx': 'export default () => null;' },
      timestamp: new Date().toISOString(),
    });

    const got = await getSnapshot(db!, 'chat_abc');
    expect(got?.version).toBe(3);
    expect(got?.files['src/App.tsx']).toBe('export default () => null;');

    expect(await getSnapshot(db!, 'missing')).toBeUndefined();
  });
});
