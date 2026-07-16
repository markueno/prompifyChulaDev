import { atom } from 'nanostores';
import type { FileMap } from '~/lib/stores/files';
import { buildSnapshot } from '~/lib/snapshots/buildSnapshot';
import { uploadBlobs } from '~/lib/snapshots/uploadBlobs';
import { serverCircuit } from '~/lib/persistence/serverCircuit';
import { openDatabase, getSnapshot, setSnapshot, queueWrite, getNextId } from '~/lib/persistence/db';
import { initOfflineDrain } from '~/lib/persistence/drainQueue';
import { buildProjectChatPath, DEFAULT_PROJECT_ID, resolveProjectIdFromPathname } from '~/utils/chatRoutes';
import { diffManifests } from '~/lib/snapshots/diffManifests';

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

/*
 * In-flight save promise + an unload flush. The Cmd+S keymap handler is synchronous
 * and fire-and-forget, so without this a hard refresh during the async chain
 * (buildSnapshot -> getSnapshot -> setSnapshot) cancels the IndexedDB write and the
 * edit is lost. We track the pending save and flush it on pagehide/visibilitychange
 * (clearing the debounce timer and firing run() immediately). The optimistic Tier-1
 * IndexedDB cache write is the critical bit for refresh-restore; starting it before
 * unload gives it the best chance to commit.
 */
let inFlightSave: Promise<void> | undefined;
let lastSaveArgs: {
  fileMap: FileMap;
  overrideChatId?: string;
  lastMessageId?: string;
  label?: string;
  changedFilePath?: string;
} | undefined;
let flushHandlersRegistered = false;

function flushPendingSave(): void {
  if (snapshotSaveTimer) {
    clearTimeout(snapshotSaveTimer);
    snapshotSaveTimer = undefined;
  }

  // Fire the save now (best-effort — the page is unloading). inFlightSave tracks it.
  if (lastSaveArgs && !inFlightSave) {
    void runSave(
      lastSaveArgs.fileMap,
      lastSaveArgs.overrideChatId,
      lastSaveArgs.lastMessageId,
      lastSaveArgs.label,
      lastSaveArgs.changedFilePath,
    );
  }
}

function registerFlushHandlers(): void {
  if (flushHandlersRegistered || typeof window === 'undefined') {
    return;
  }

  flushHandlersRegistered = true;

  // pagehide fires on hard refresh + tab close (including bfcache). Flush the
  // debounced/immediate save so the IndexedDB write starts before unload.
  window.addEventListener('pagehide', () => {
    flushPendingSave();
  });

  // visibilitychange (hidden) covers mobile backgrounding + some refresh paths.
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingSave();
    }
  });
}

async function runSave(
  fileMap: FileMap,
  overrideChatId: string | undefined,
  lastMessageId: string | undefined,
  label?: string,
  changedFilePath?: string,
): Promise<void> {
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

  // Day 19 — pass a manual-edit marker as the label when only the file path is known.
  const resolvedLabel = label ?? (changedFilePath ? `Manual edit — ${changedFilePath}` : undefined);

  await saveCodebaseSnapshot(id, fileMap, undefined, lastMessageId, resolvedLabel, changedFilePath);
}

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

/*
 * Day 19 — last manifest saved per chatId (client-side cheap skip). Avoids the server
 * round-trip when nothing changed (the server guard is still authoritative). Populated
 * from the optimistic cache + server response.
 */
const lastSavedManifestByChatId = new Map<string, Record<string, string>>();

async function saveCodebaseSnapshot(
  id: string,
  fileMap: FileMap,
  descriptionText: string | undefined,
  lastMessageId?: string,
  label?: string,
  changedFilePath?: string,
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
     * Day 19 — compute a compact change summary from the last manifest we saved for this
     * chat (kept in lastSavedManifestByChatId, seeded from the optimistic IndexedDB cache).
     * This is the SAME diff the server computes authoritatively in saveCodebaseVersionPostgres.
     */
    const previousManifest = lastSavedManifestByChatId.get(id);
    const diff = diffManifests(previousManifest, snapshot.manifest);
    const changeSummary = diff.summary || undefined;

    /*
     * Optimistic Tier-1 cache write FIRST — before the server round-trip. loadSnapshot reads
     * this IndexedDB cache before hitting the server, so writing it now means a page refresh
     * restores the LATEST files even if the server version-save then fails (circuit open,
     * offline, or an auth/ownership/FK error on POST /api/chats/:id/version — e.g. the
     * admin-bypass user). Previously the cache was only written on server success, so any
     * server failure silently lost manual edits on refresh. Keep the existing version number
     * if we have one; the real server version overwrites it on success below.
     *
     * Day 19 — also seed lastSavedManifestByChatId from the cache so the cheap client skip and
     * change-summary are correct on the very first save of a session.
     */
    if (db) {
      try {
        const existing = await getSnapshot(db, id);

        if (existing?.manifest && !previousManifest) {
          lastSavedManifestByChatId.set(id, existing.manifest);
        }

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

    /*
     * Day 19 — Fix A (client side): if the manifest is unchanged since the last save, skip the
     * network round-trip entirely. The server guard would no-op anyway. Keep the optimistic
     * cache write above so the cache timestamp stays fresh (flush logic). If a label was
     * supplied (manual save) but nothing changed we still skip — there's no version to name.
     */
    if (!diff.changed && previousManifest) {
      return;
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
            // Day 19 — meaningful per-version name + changed-files summary (Fix B).
            label,
            changeSummary,
          }),
        });

        if (!versionRes.ok) {
          throw new Error(`Version save failed: ${versionRes.status}`);
        }

        return ((await versionRes.json()) as { version: number }).version;
      });

      // Remember this manifest so the next save can cheap-skip + diff against it.
      lastSavedManifestByChatId.set(id, snapshot.manifest);

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
export function scheduleSnapshotSave(
  fileMap: FileMap,
  overrideChatId?: string,
  lastMessageId?: string,
  immediate?: boolean,
  /** Day 19 — per-version label (user prompt for AI turns; "Manual edit" marker otherwise). */
  label?: string,
  /** Day 19 — for manual saves, the file path that was edited (used to build a label). */
  changedFilePath?: string,
): () => void {
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

  registerFlushHandlers();

  // Remember the args so a pagehide/visibilitychange flush can re-fire the save
  // (best-effort) before the page unloads — closes the refresh-during-save race.
  lastSaveArgs = { fileMap, overrideChatId, lastMessageId, label, changedFilePath };

  if (immediate) {
    inFlightSave = runSave(fileMap, overrideChatId, lastMessageId, label, changedFilePath).finally(() => {
      inFlightSave = undefined;
    });
    return () => {};
  }

  snapshotSaveTimer = setTimeout(() => {
    inFlightSave = runSave(fileMap, overrideChatId, lastMessageId, label, changedFilePath).finally(() => {
      inFlightSave = undefined;
    });
  }, 3000);

  return () => {
    if (snapshotSaveTimer) {
      clearTimeout(snapshotSaveTimer);
      snapshotSaveTimer = undefined;
    }
  };
}
