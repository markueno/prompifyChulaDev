/*
 * app/lib/snapshots/diffManifests.ts
 *
 * Pure, order-insensitive manifest diff. A manifest is {relativePath: sha256hex}.
 * Used by:
 *  - the server-side no-op guard in saveCodebaseVersionPostgres (Fix A): if the incoming
 *    manifest equals the current is_latest manifest, skip inserting a new version row.
 *  - the change-summary shown in the version-history dropdown (Fix B): added/modified/removed
 *    file lists derived from the SAME diff.
 * No network, no DB — mirrors the versionMeta.ts convention.
 */

export interface ManifestDiff {
  /** false iff old and new have the same key set with identical hash per key. */
  changed: boolean;
  /** paths present in new but absent from old. */
  added: string[];
  /** paths present in both whose hash differs. */
  modified: string[];
  /** paths present in old but absent from new. */
  removed: string[];
  /** Compact human-readable summary, e.g. "Edited App.tsx, index.css (+1, -1)". */
  summary: string;
}

/**
 * Returns the last path segment of a posix path (basename). Falls back to the
 * full path if there is no separator. Kept dependency-free (no node 'path' on the client).
 */
function basename(path: string): string {
  const idx = path.lastIndexOf('/');

  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Build a compact summary string from added/modified/removed path lists.
 * Example: "Edited App.tsx, index.css (+1, -2)" — edited names first, then tail counts.
 * Returns '' when nothing changed.
 */
export function summarizeChanges(added: string[], modified: string[], removed: string[]): string {
  const edited = [...modified, ...added];
  const addedCount = added.length;
  const removedCount = removed.length;

  const parts: string[] = [];

  if (edited.length > 0) {
    const names = edited.slice(0, 3).map(basename).join(', ');
    const extra = edited.length - 3;
    const editedLabel = modified.length > 0 && addedCount === 0 ? 'Edited' : addedCount > 0 && modified.length === 0 ? 'Added' : 'Edited';
    parts.push(`${editedLabel} ${names}${extra > 0 ? ` +${extra}` : ''}`);
  } else if (removedCount > 0) {
    const names = removed.slice(0, 3).map(basename).join(', ');
    const extra = removedCount - 3;
    parts.push(`Removed ${names}${extra > 0 ? ` +${extra}` : ''}`);
  }

  const counts: string[] = [];

  if (addedCount > 0 && (modified.length > 0 || removedCount > 0)) {
    counts.push(`+${addedCount}`);
  }

  if (removedCount > 0 && (modified.length > 0 || addedCount > 0)) {
    counts.push(`-${removedCount}`);
  }

  const tail = counts.length > 0 ? ` (${counts.join(', ')})` : '';

  return parts.length > 0 ? `${parts.join(', ')}${tail}` : '';
}

export function diffManifests(
  oldManifest?: Record<string, string> | null,
  newManifest?: Record<string, string> | null,
): ManifestDiff {
  const oldM = oldManifest ?? {};
  const newM = newManifest ?? {};

  const oldKeys = new Set(Object.keys(oldM));
  const newKeys = new Set(Object.keys(newM));

  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  for (const key of newKeys) {
    if (!oldKeys.has(key)) {
      added.push(key);
    } else if (oldM[key] !== newM[key]) {
      modified.push(key);
    }
  }

  for (const key of oldKeys) {
    if (!newKeys.has(key)) {
      removed.push(key);
    }
  }

  // Stable ordering for deterministic summaries/tests.
  added.sort();
  modified.sort();
  removed.sort();

  const changed = added.length > 0 || modified.length > 0 || removed.length > 0;

  return {
    changed,
    added,
    modified,
    removed,
    summary: summarizeChanges(added, modified, removed),
  };
}
