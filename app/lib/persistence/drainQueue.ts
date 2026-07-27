/*
 * app/lib/persistence/drainQueue.ts
 *
 * Day 11 (IMPLEMENTATION-PLAN Step 11.2): drain the offline outbox on reconnect.
 * Implemented from ARCHITECTURE-v2.md:577-597 — writes drain in timestamp order; the first
 * failure stops the drain and keeps the remaining writes queued. Every server submission goes
 * through the persisted circuit breaker (Step 11.1), so a down server opens the circuit after
 * 3 failures instead of being hammered.
 *
 * Triggers (ARCHITECTURE-v2.md:593-597):
 *  1. `window` 'online' event
 *  2. successful health check after the circuit was open (30s polling while open)
 *  3. page load (in case the tab was closed while offline)
 */
import { atom } from 'nanostores';
import { deletePendingWrite, getPendingWrites, updatePendingWriteRetryCount, type PendingWrite } from './db';
import { serverCircuit } from './serverCircuit';
import { uploadBlobs } from '~/lib/snapshots/uploadBlobs';
import type { Snapshot } from '~/lib/snapshots/buildSnapshot';

/** Day 12 — 'draining' while a drain run is in flight so the UI can show a syncing state. */
export const drainStatusStore = atom<'idle' | 'draining'>('idle');

/**
 * Replay one queued write against the server. Throws on any transient failure so the caller
 * stops draining (doc :587-589). Returns 'unretryable' for writes that can never succeed
 * (unknown type, or a pre-Day-11 'version' payload that lacks file contents while the server
 * is missing blobs) — the caller deletes those instead of blocking the queue head forever.
 */
async function submitToServer(write: PendingWrite): Promise<'done' | 'unretryable'> {
  if (write.type !== 'version') {
    console.warn('Dropping pending write of unknown type:', write.type);
    return 'unretryable';
  }

  const { manifest, blobs, description, files, messageId } = write.payload as {
    manifest: Record<string, string>;
    blobs: Record<string, number>;
    description?: string;
    files?: Record<string, string>;
    messageId?: string;
  };

  const hashes = [...new Set(Object.values(manifest))];

  return serverCircuit.execute(async () => {
    const dedupRes = await fetch('/api/snapshots/dedup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes }),
    });

    if (!dedupRes.ok) {
      throw new Error(`Dedup failed: ${dedupRes.status}`);
    }

    const { missing } = (await dedupRes.json()) as { missing: string[] };

    if (missing.length > 0) {
      if (!files) {
        /*
         * Queued before the payload carried file contents (pre-Day-11) — the missing blobs
         * can never be uploaded from this entry. Unretryable by construction, not a server
         * problem, so don't trip the circuit and don't block the queue.
         */
        console.warn('Dropping pending version write without file contents (blobs missing server-side):', write.id);
        return 'unretryable' as const;
      }

      await uploadBlobs({ manifest, files } as Snapshot, missing);
    }

    const versionRes = await fetch(`/api/chats/${write.chatId}/version`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest, blobs, description, messageId }),
    });

    if (!versionRes.ok) {
      throw new Error(`Version save failed: ${versionRes.status}`);
    }

    return 'done' as const;
  });
}

let draining = false;

/**
 * Drain queued writes in timestamp order (ARCHITECTURE-v2.md:577-591). Stops at the first
 * transient failure, deletes each write only AFTER its successful submission (no double-submit
 * window: re-submitting a version is idempotent server-side — same content hashes dedup to
 * zero uploads — while deleting first would lose the write on a crash).
 */
export async function drainPendingWrites(db: IDBDatabase | undefined): Promise<void> {
  if (!db || draining) {
    return;
  }

  draining = true;
  drainStatusStore.set('draining');

  try {
    const writes = await getPendingWrites(db);

    for (const write of writes.sort((a, b) => a.timestamp - b.timestamp)) {
      try {
        const result = await submitToServer(write);

        if (write.id !== undefined) {
          await deletePendingWrite(db, write.id);
        }

        if (result === 'unretryable') {
          continue;
        }
      } catch {
        /*
         * Increment retry count; drop writes that fail more than 5 times
         * (dead-letter — avoids infinite retry of permanently-broken writes).
         * Stop draining on any failure so we don't exhaust the queue on a
         * transient outage.
         */
        if (write.retryCount >= 5) {
          if (write.id !== undefined) {
            await deletePendingWrite(db, write.id);
          }

          continue;
        }

        await updatePendingWriteRetryCount(db, write.id!, write.retryCount + 1);
        break;
      }
    }
  } finally {
    draining = false;
    drainStatusStore.set('idle');
  }
}

let initialized = false;

/**
 * Wire the three drain triggers. Idempotent; client-only (no-op during SSR). Called from
 * useChatHistory module init so it runs exactly once per page load.
 */
export function initOfflineDrain(db: IDBDatabase | undefined): void {
  if (initialized || typeof window === 'undefined' || !db) {
    return;
  }

  initialized = true;

  // Trigger 1 — browser regained connectivity.
  window.addEventListener('online', () => {
    void drainPendingWrites(db);
  });

  /*
   * Trigger 3 — page load (tab may have been closed while offline). Delay a few seconds so
   * the drain never competes with app boot (WebContainer boot, chat load).
   */
  window.setTimeout(() => {
    void drainPendingWrites(db);
  }, 5_000);

  /*
   * Trigger 2 — while the circuit is open, health-check every 30s (matches RECOVERY_TIMEOUT,
   * so each tick can move the circuit open → half-open → closed) and drain on recovery.
   */
  window.setInterval(async () => {
    if (!serverCircuit.isOpen) {
      return;
    }

    try {
      await serverCircuit.execute(async () => {
        const res = await fetch('/api/health');

        if (!res.ok) {
          throw new Error(`Health check failed: ${res.status}`);
        }
      });

      void drainPendingWrites(db);
    } catch {
      // still down — circuit re-opened, next tick retries
    }
  }, 30_000);
}
