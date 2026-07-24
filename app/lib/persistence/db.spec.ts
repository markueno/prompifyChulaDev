/*
 * R1 SAFETY GATE (IMPLEMENTATION-PLAN Day 8): proves that opening the DB from a legacy v1 store
 * (the pre-snapshots state a real user carries) upgrades straight to the current v3 and adds the
 * `snapshots` + `pendingWrites` stores WITHOUT dropping the existing `chats` store or its data.
 * This is the single most dangerous change in the plan (local chat-history loss), so it is
 * asserted automatically, not checked by hand.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDatabase, getAll, getSnapshot, setSnapshot, queueWrite, getPendingWrites, deletePendingWrite } from './db';

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

describe('openDatabase v1 -> v3 upgrade', () => {
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
    expect(db!.version).toBeGreaterThanOrEqual(3);
    expect(db!.objectStoreNames.contains('chats')).toBe(true);
    expect(db!.objectStoreNames.contains('snapshots')).toBe(true);
    // A v1 user jumping straight to v3 must also get the offline outbox store, not just snapshots.
    expect(db!.objectStoreNames.contains('pendingWrites')).toBe(true);

    const chats = await getAll(db!);
    expect(chats).toHaveLength(1);
    expect(chats[0].id).toBe('1');
    expect(chats[0].urlId).toBe('seed-url');
  });

  it('creates both stores from scratch when no prior DB exists', async () => {
    const db = await openDatabase();
    expect(db!.version).toBeGreaterThanOrEqual(3);
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

/*
 * Build a v2 `boltHistory` (chats + snapshots), then seed representative data so the
 * v2 -> v3 upgrade test has real rows to preserve.
 */
function seedV2(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('boltHistory', 2);

    request.onupgradeneeded = () => {
      const db = request.result;
      const chats = db.createObjectStore('chats', { keyPath: 'id' });
      chats.createIndex('id', 'id', { unique: true });
      chats.createIndex('urlId', 'urlId', { unique: true });
      db.createObjectStore('snapshots', { keyPath: 'chatId' });
    };

    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['chats', 'snapshots'], 'readwrite');

      tx.objectStore('chats').put({
        id: '1',
        urlId: 'seed-url',
        messages: [],
        description: 'seeded v2 chat',
        timestamp: new Date().toISOString(),
      });

      tx.objectStore('snapshots').put({
        chatId: '1',
        version: 1,
        manifest: { 'src/main.ts': 'abc123' },
        files: { 'src/main.ts': 'console.log(1);' },
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

describe('openDatabase v2 -> v3 upgrade', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('preserves chats + snapshots and adds pendingWrites store', async () => {
    await seedV2();

    const db = await openDatabase();
    expect(db).toBeDefined();
    expect(db!.version).toBe(3);
    expect(db!.objectStoreNames.contains('chats')).toBe(true);
    expect(db!.objectStoreNames.contains('snapshots')).toBe(true);
    expect(db!.objectStoreNames.contains('pendingWrites')).toBe(true);

    const chats = await getAll(db!);
    expect(chats).toHaveLength(1);
    expect(chats[0].id).toBe('1');

    const snap = await getSnapshot(db!, '1');
    expect(snap?.version).toBe(1);
    expect(snap?.files['src/main.ts']).toBe('console.log(1);');
  });

  it('round-trips a pending write through the pendingWrites store', async () => {
    const db = await openDatabase();

    await queueWrite(db!, 'version', 'chat_test', {
      manifest: { 'src/App.tsx': 'feedbeef' },
    });

    const writes = await getPendingWrites(db!);
    expect(writes).toHaveLength(1);
    expect(writes[0].type).toBe('version');
    expect(writes[0].chatId).toBe('chat_test');

    await deletePendingWrite(db!, writes[0].id!);

    const after = await getPendingWrites(db!);
    expect(after).toHaveLength(0);
  });
});
