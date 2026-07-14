import { atom } from 'nanostores';
import type { FileMap } from '~/lib/stores/files';
import { buildSnapshot } from '~/lib/snapshots/buildSnapshot';
import { uploadBlobs } from '~/lib/snapshots/uploadBlobs';
import { serverCircuit } from '~/lib/persistence/serverCircuit';
import { openDatabase, getSnapshot, setSnapshot, queueWrite, getNextId } from '~/lib/persistence/db';
import { initOfflineDrain } from '~/lib/persistence/drainQueue';
import { buildProjectChatPath, DEFAULT_PROJECT_ID, resolveProjectIdFromPathname } from '~/utils/chatRoutes';

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;
export const db = persistenceEnabled ? await openDatabase() : undefined;
export const snapshotsEnabled = import.meta.env.VITE_SNAPSHOTS_ENABLED === 'true';

if (snapshotsEnabled) {
  initOfflineDrain(db);
}

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);

let snapshotSaveTimer: ReturnType<typeof setTimeout> | undefined;
let ensureChatIdInFlight: Promise<string | undefined> | undefined;

/**
 * B1b — allocate and adopt a chat id when none exists yet (brand-new chat before the first
 * AI response), so manual/auto saves are not silently dropped. Mirrors what
 * useChatHistory.storeMessageHistory does on the first response: allocate the next id,
 * publish it on the shared chatId atom, and rewrite the URL to the chat's path (so a later
 * message send and the eventual message history attach to the same chat). Single-flight so
 * two concurrent saves cannot allocate two different ids.
 */
export function ensureChatIdForSave(projectId?: string): Promise<string | undefined> {
  const current = chatId.get();

  if (current) {
    return Promise.resolve(current);
  }

  if (!db || typeof window === 'undefined') {
    return Promise.resolve(undefined);
  }

  if (!ensureChatIdInFlight) {
    const database = db;
    ensureChatIdInFlight = (async () => {
      try {
        const nextId = await getNextId(database);
        chatId.set(nextId);

        const resolvedProjectId =
          projectId || resolveProjectIdFromPathname(window.location.pathname) || DEFAULT_PROJECT_ID;
        const url = new URL(window.location.href);
        url.pathname = buildProjectChatPath(resolvedProjectId, nextId);
        window.history.replaceState({}, '', url);

        return nextId;
      } finally {
        ensureChatIdInFlight = undefined;
      }
    })();
  }

  return ensureChatIdInFlight;
}

async function saveCodebaseSnapshot(
  id: string,
  fileMap: FileMap,
  descriptionText: string | undefined,
  lastMessageId?: string,
): Promise<void> {
  try {
    const snapshot = await buildSnapshot(fileMap);
    const hashes = [...new Set(Object.values(snapshot.manifest))];

    if (hashes.length === 0) {
      return;
    }

    const encoder = new TextEncoder();
    const blobs: Record<string, number> = {};

    for (const [path, sha] of Object.entries(snapshot.manifest)) {
      if (blobs[sha] === undefined) {
        blobs[sha] = encoder.encode(snapshot.files[path]).byteLength;
      }
    }

    /*
     * Optimistic Tier-1 cache write FIRST — before the server round-trip. loadSnapshot reads
     * this IndexedDB cache before hitting the server, so writing it now means a page refresh
     * restores the LATEST files even if the server version-save then fails (circuit open,
     * offline, or an auth/ownership/FK error on POST /api/chats/:id/version — e.g. the
     * admin-bypass user). Previously the cache was only written on server success, so any
     * server failure silently lost manual edits on refresh. Keep the existing version number
     * if we have one; the real server version overwrites it on success below.
     */
    if (db) {
      try {
        const existing = await getSnapshot(db, id);
        await setSnapshot(db, {
          chatId: id,
          version: existing?.version ?? 0,
          manifest: snapshot.manifest,
          files: snapshot.files,
          timestamp: new Date().toISOString(),
        });
      } catch (cacheError) {
        console.warn('Optimistic snapshot cache write failed (continuing to server save):', cacheError);
      }
    }

    try {
      const version = await serverCircuit.execute(async () => {
        const dedupRes = await fetch('/api/snapshots/dedup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hashes }),
        });

        if (!dedupRes.ok) {
          throw new Error(`Dedup failed: ${dedupRes.status}`);
        }

        const { missing } = (await dedupRes.json()) as { missing: string[] };

        await uploadBlobs(snapshot, missing);

        const versionRes = await fetch(`/api/chats/${id}/version`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            manifest: snapshot.manifest,
            blobs,
            description: descriptionText,
            messageId: lastMessageId,
          }),
        });

        if (!versionRes.ok) {
          throw new Error(`Version save failed: ${versionRes.status}`);
        }

        return ((await versionRes.json()) as { version: number }).version;
      });

      if (db) {
        await setSnapshot(db, {
          chatId: id,
          version,
          manifest: snapshot.manifest,
          files: snapshot.files,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (serverError) {
      console.warn('Snapshot server save failed, enqueuing for retry:', serverError);

      if (db) {
        await queueWrite(db, 'version', id, {
          manifest: snapshot.manifest,
          blobs,
          description: descriptionText,
          files: snapshot.files,
          messageId: lastMessageId,
        });
      }
    }
  } catch (error) {
    console.warn('Snapshot save failed (chat save unaffected):', error);
  }
}

/**
 * Debounced snapshot save for codebase state. Reads chatId/description from the
 * shared atoms (unless chatId is overridden) and returns a cleanup function.
 * Pass immediate=true to skip the debounce (for manual saves where the user may
 * refresh the page before the timer fires).
 * B1b — when no chat id exists yet (brand-new chat before the first AI response),
 * one is allocated via ensureChatIdForSave instead of silently dropping the save.
 */
export function scheduleSnapshotSave(fileMap: FileMap, overrideChatId?: string, lastMessageId?: string, immediate?: boolean): () => void {
  if (!snapshotsEnabled) {
    return () => {};
  }

  // Nothing to save — don't allocate a chat id for an empty workbench.
  if (Object.keys(fileMap).length === 0) {
    return () => {};
  }

  if (snapshotSaveTimer) {
    clearTimeout(snapshotSaveTimer);
    snapshotSaveTimer = undefined;
  }

  const descriptionText = description.get();

  const run = async () => {
    let id = overrideChatId ?? chatId.get();

    if (!id) {
      try {
        id = await ensureChatIdForSave();
      } catch (error) {
        console.warn('Could not allocate a chat id for the snapshot save:', error);
        return;
      }
    }

    if (!id) {
      return;
    }

    await saveCodebaseSnapshot(id, fileMap, descriptionText, lastMessageId);
  };

  if (immediate) {
    void run();
    return () => {};
  }

  snapshotSaveTimer = setTimeout(() => {
    void run();
  }, 3000);

  return () => {
    if (snapshotSaveTimer) {
      clearTimeout(snapshotSaveTimer);
      snapshotSaveTimer = undefined;
    }
  };
}
