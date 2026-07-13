import { atom } from 'nanostores';
import type { FileMap } from '~/lib/stores/files';
import { buildSnapshot } from '~/lib/snapshots/buildSnapshot';
import { uploadBlobs } from '~/lib/snapshots/uploadBlobs';
import { serverCircuit } from '~/lib/persistence/serverCircuit';
import { openDatabase, setSnapshot, queueWrite } from '~/lib/persistence/db';
import { initOfflineDrain } from '~/lib/persistence/drainQueue';

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;
export const db = persistenceEnabled ? await openDatabase() : undefined;
export const snapshotsEnabled = import.meta.env.VITE_SNAPSHOTS_ENABLED === 'true';

if (snapshotsEnabled) {
  initOfflineDrain(db);
}

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);

let snapshotSaveTimer: ReturnType<typeof setTimeout> | undefined;

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
 */
export function scheduleSnapshotSave(fileMap: FileMap, overrideChatId?: string, lastMessageId?: string): () => void {
  if (!snapshotsEnabled) {
    return () => {};
  }

  const id = overrideChatId ?? chatId.get();

  if (!id) {
    return () => {};
  }

  if (snapshotSaveTimer) {
    clearTimeout(snapshotSaveTimer);
  }

  const descriptionText = description.get();
  snapshotSaveTimer = setTimeout(() => {
    void saveCodebaseSnapshot(id, fileMap, descriptionText, lastMessageId);
  }, 3000);

  return () => {
    if (snapshotSaveTimer) {
      clearTimeout(snapshotSaveTimer);
      snapshotSaveTimer = undefined;
    }
  };
}
