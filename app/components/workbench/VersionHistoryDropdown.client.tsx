/*
 * Day 17 — version history dropdown in the workbench header.
 * Lists a chat's snapshot versions (Day 15 endpoint) and restores any of them via the
 * append-only rollback (Day 16) followed by an in-place remount — no page reload, nothing
 * ever lost (restoring creates a NEW version, so you can restore the restore).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { chatId } from '~/lib/persistence';
import { openDatabase, setSnapshot } from '~/lib/persistence/db';
import { loadSnapshotVersion } from '~/lib/snapshots/loadSnapshot';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

interface VersionRow {
  versionNumber: number;
  description: string | null;
  fileCount: number;
  totalBytes: number;
  isLatest: boolean;
  messageId: string | null;
  changeSummary: string | null;
  createdAt: string;
}

const snapshotsEnabled = import.meta.env.VITE_SNAPSHOTS_ENABLED === 'true';

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) {
    return 'just now';
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }

  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  if (seconds < 7 * 86400) {
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  return new Date(iso).toLocaleDateString();
}

export function VersionHistoryDropdown() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<VersionRow | null>(null);
  const [restoring, setRestoring] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentChatId = chatId.get();

  const loadVersions = useCallback(async () => {
    const id = chatId.get();

    if (!id) {
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`/api/chats/${id}/versions`);

      if (res.ok) {
        const data = (await res.json()) as { versions: VersionRow[] };
        setVersions(data.versions);
      } else {
        setVersions([]);
      }
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadVersions();
    }
  }, [open, loadVersions]);

  // Close on outside click.
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', onClick);

    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleRestore = useCallback(async (target: VersionRow) => {
    const id = chatId.get();

    if (!id) {
      return;
    }

    setRestoring(true);

    try {
      // 1. Append-only rollback server-side — creates a new latest version copying the target.
      const rollbackRes = await fetch(`/api/chats/${id}/rollback?version=${target.versionNumber}`, {
        method: 'POST',
      });

      if (!rollbackRes.ok) {
        throw new Error(`Rollback failed (${rollbackRes.status})`);
      }

      const { version: newVersion } = (await rollbackRes.json()) as { version: number };

      // 2. Download the restored content and remount it in place (orphans removed).
      const snapshot = await loadSnapshotVersion(id, newVersion);

      if (!snapshot) {
        throw new Error('Rolled back, but downloading the restored files failed — reload the page to remount');
      }

      await workbenchStore.mountSnapshot(snapshot.files, { removeOrphans: true });

      // 3. Update the local latest-snapshot cache so the next page load restores this state.
      const db = await openDatabase();

      if (db) {
        try {
          await setSnapshot(db, {
            chatId: id,
            version: newVersion,
            manifest: snapshot.manifest,
            files: snapshot.files,
            timestamp: new Date().toISOString(),
          });
        } catch {
          // cache write is best-effort
        }
      }

      toast.success(`Restored v${target.versionNumber} (saved as v${newVersion})`);
      setConfirmTarget(null);
      await loadVersions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Restore failed');
    } finally {
      setRestoring(false);
    }
  }, [loadVersions]);

  if (!snapshotsEnabled || !currentChatId) {
    return null;
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        className={classNames(
          'relative ml-1 flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-sm transition-colors',
          open
            ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
            : 'text-bolt-elements-item-contentDefault hover:text-bolt-elements-item-contentActive'
        )}
        onClick={() => setOpen(v => !v)}
        title="Version history — restore any earlier state of this project"
      >
        <div className="i-ph:clock-counter-clockwise w-3.5 h-3.5" />
        History
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto z-50 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-lg">
          <div className="px-3 py-2 text-xs font-medium text-bolt-elements-textSecondary border-b border-bolt-elements-borderColor sticky top-0 bg-bolt-elements-background-depth-2">
            Version history
          </div>

          {loading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-bolt-elements-textSecondary">
              <div className="i-ph:spinner animate-spin" />
              Loading…
            </div>
          ) : versions.length === 0 ? (
            <div className="px-3 py-4 text-sm text-bolt-elements-textSecondary">
              No versions saved yet — versions appear automatically as the project is built.
            </div>
          ) : (
            <ul>
              {versions.map(v => (
                <li
                  key={v.versionNumber}
                  className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor/50 last:border-b-0 hover:bg-bolt-elements-background-depth-3 transition-colors"
                >
                  <span
                    className={classNames(
                      'shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                      v.isLatest
                        ? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300'
                        : 'bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary'
                    )}
                  >
                    v{v.versionNumber}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm text-bolt-elements-textPrimary">
                      {v.changeSummary || v.description || 'Untitled version'}
                    </div>
                    {v.description && v.changeSummary && (
                      <div className="truncate text-[11px] text-bolt-elements-textSecondary">
                        {v.description}
                      </div>
                    )}
                    <div className="text-[11px] text-bolt-elements-textTertiary">
                      {relativeTime(v.createdAt)} · {v.fileCount} files · {formatBytes(v.totalBytes)}
                      {v.changeSummary ? ` · changed: ${v.changeSummary}` : ''}
                      {v.isLatest ? ' · current' : ''}
                    </div>
                  </div>

                  {!v.isLatest && (
                    <button
                      className="shrink-0 rounded-md px-2 py-1 text-xs text-bolt-elements-item-contentDefault hover:text-bolt-elements-item-contentActive hover:bg-bolt-elements-background-depth-1 transition-colors"
                      onClick={() => setConfirmTarget(v)}
                      title={`Restore version ${v.versionNumber}`}
                    >
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <DialogRoot open={confirmTarget !== null}>
        <Dialog onBackdrop={() => setConfirmTarget(null)} onClose={() => setConfirmTarget(null)}>
          {confirmTarget && (
            <>
              <div className="p-6 bg-white dark:bg-gray-950">
                <DialogTitle className="text-gray-900 dark:text-white">
                  Restore version {confirmTarget.versionNumber}?
                </DialogTitle>
                <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                  <p>
                    The project files will be replaced with{' '}
                    <span className="font-medium text-gray-900 dark:text-white">
                      v{confirmTarget.versionNumber}
                    </span>{' '}
                    ({confirmTarget.fileCount} files, {formatBytes(confirmTarget.totalBytes)},{' '}
                    {relativeTime(confirmTarget.createdAt)}).
                  </p>
                  <p className="mt-2">
                    Nothing is lost: the current state stays in the history, and the restore itself is
                    saved as a new version.
                  </p>
                </DialogDescription>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
                <DialogButton type="secondary" onClick={() => setConfirmTarget(null)}>
                  Cancel
                </DialogButton>
                <DialogButton type="primary" onClick={() => void handleRestore(confirmTarget)}>
                  {restoring ? 'Restoring…' : 'Restore'}
                </DialogButton>
              </div>
            </>
          )}
        </Dialog>
      </DialogRoot>
    </div>
  );
}
