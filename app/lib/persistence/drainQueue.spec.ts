/*
 * Day 11 (IMPLEMENTATION-PLAN Step 11.2 verification): queued writes drain in timestamp order,
 * each is deleted only AFTER successful submission (red flag: "drain double-submits / no delete
 * after success"), the first transient failure stops the drain, and unretryable writes are
 * dropped without blocking the queue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

type DrainModule = typeof import('./drainQueue');
type DbModule = typeof import('./db');

let drainQueue: DrainModule;
let dbModule: DbModule;
let db: IDBDatabase;

// Route mocked fetch responses by URL.
function mockFetch(handlers: { dedup?: () => Response; version?: () => Response; health?: () => Response }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('/api/snapshots/dedup')) {
      return (handlers.dedup ?? (() => jsonResponse({ missing: [] })))();
    }

    if (url.includes('/version')) {
      return (handlers.version ?? (() => jsonResponse({ version: 1 })))();
    }

    if (url.includes('/api/health')) {
      return (handlers.health ?? (() => jsonResponse({})))();
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function queueVersionWrite(chatId: string, timestamp: number, withFiles = true) {
  // queueWrite stamps Date.now() — pin it per write so ordering is deterministic.
  vi.setSystemTime(timestamp);
  await dbModule.queueWrite(db, 'version', chatId, {
    manifest: { '/home/project/a.txt': 'hash_a' },
    blobs: { hash_a: 4 },
    description: 'test',
    ...(withFiles ? { files: { '/home/project/a.txt': 'AAAA' } } : {}),
  });
}

describe('drainPendingWrites', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();

    // Fake ONLY Date (for deterministic queueWrite timestamps) — faking setTimeout would
    // stall fake-indexeddb's async event delivery and hang openDatabase.
    vi.useFakeTimers({ toFake: ['Date'] });

    // Fresh module graph per test: fresh circuit singleton + fresh `draining` flag.
    vi.resetModules();
    dbModule = await import('./db');
    drainQueue = await import('./drainQueue');

    db = (await dbModule.openDatabase())!;
    expect(db).toBeDefined();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    globalThis.indexedDB = new IDBFactory();
  });

  it('drains writes in timestamp order and empties the store', async () => {
    await queueVersionWrite('chat_late', 2000);
    await queueVersionWrite('chat_early', 1000);

    const fetchMock = mockFetch({});
    vi.stubGlobal('fetch', fetchMock);

    await drainQueue.drainPendingWrites(db);

    const versionCalls = fetchMock.mock.calls.map(c => String(c[0])).filter(u => u.includes('/version'));
    expect(versionCalls).toEqual(['/api/chats/chat_early/version', '/api/chats/chat_late/version']);

    expect(await dbModule.getPendingWrites(db)).toHaveLength(0);
  });

  it('stops at the first failure and keeps remaining writes queued (no delete on failure)', async () => {
    await queueVersionWrite('chat_1', 1000);
    await queueVersionWrite('chat_2', 2000);

    vi.stubGlobal(
      'fetch',
      mockFetch({ dedup: () => jsonResponse({ error: 'down' }, 500) })
    );

    await drainQueue.drainPendingWrites(db);

    // First write failed -> drain stopped -> BOTH writes still queued.
    expect(await dbModule.getPendingWrites(db)).toHaveLength(2);
  });

  it('drops unretryable writes (missing blobs, no file contents) and continues', async () => {
    await queueVersionWrite('chat_old', 1000, false); // pre-Day-11 payload without files
    await queueVersionWrite('chat_new', 2000);

    const fetchMock = mockFetch({
      dedup: () => jsonResponse({ missing: ['hash_a'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // chat_old: blobs missing + no files -> unretryable, deleted, drain continues.
    // chat_new: has files -> uploadBlobs path -> needs upload-url; extend the router:
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/api/snapshots/dedup')) {
        return jsonResponse({ missing: ['hash_a'] });
      }

      if (url.includes('/api/snapshots/upload-url')) {
        return jsonResponse({ url: 'https://obs.example/put/hash_a' });
      }

      if (url.includes('obs.example')) {
        return new Response(null, { status: 200 });
      }

      if (url.includes('/version')) {
        return jsonResponse({ version: 1 });
      }

      throw new Error(`Unexpected fetch in test: ${url} ${init?.method ?? ''}`);
    });

    await drainQueue.drainPendingWrites(db);

    expect(await dbModule.getPendingWrites(db)).toHaveLength(0);

    const versionCalls = fetchMock.mock.calls.map(c => String(c[0])).filter(u => u.includes('/version'));
    expect(versionCalls).toEqual(['/api/chats/chat_new/version']);
  });

  it('is a no-op without a database handle', async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal('fetch', fetchMock);

    await drainQueue.drainPendingWrites(undefined);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
