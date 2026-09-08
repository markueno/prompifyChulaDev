/*
 * app/lib/snapshots/loadSnapshot.ts
 *
 * Client-side three-tier codebase restore (Day 8). Imported by nothing yet — wired into
 * the real chat-load flow on Day 9.
 *   Tier 1: local IndexedDB `snapshots` cache (instant, no network).
 *   Tier 2: server latest-version manifest (Day 7) + blob download from object storage.
 * Returns null when no snapshot exists or a restore step fails, so the Day-9 caller falls
 * back to message replay (Tier 3). A partial/corrupt restore is never returned.
 * Source: ARCHITECTURE-v2.md:397-442; IMPLEMENTATION-PLAN Day 8.
 */
import { openDatabase, getSnapshot, setSnapshot } from '~/lib/persistence/db';
import type { Snapshot } from './buildSnapshot';

/**
 * Convert a snapshot's stored absolute path (`/home/project-<session>/src/App.tsx`) to a
 * workdir-relative path (`src/App.tsx`) for writing into the current WebContainer (Day 9b).
 * The workdir name is per-session (sessionStorage, constants.ts), so a snapshot restored in
 * a new tab/device carries a *different* `/home/project-…/` prefix than the live container —
 * strip any `/home/<name>/` prefix generically rather than assuming it matches. Paths that
 * are already relative pass through unchanged.
 */
export function snapshotPathToRelative(absPath: string): string {
  return absPath.replace(/^\/home\/[^/]+\//, '');
}

interface LatestVersionResponse {
  version: number | null;
  manifest?: Record<string, string>;
  urls?: Record<string, string>;
}

/**
 * Reconstruct the {path: content} file map from a manifest ({path: sha}) and the downloaded
 * blob contents ({sha: content}). Pure and deterministic. Returns null if any referenced
 * hash is missing — a partial restore is worse than falling back to message replay.
 */
export function reconstructFiles(
  manifest: Record<string, string>,
  contentByHash: Map<string, string>
): Record<string, string> | null {
  const files: Record<string, string> = {};

  for (const [path, hash] of Object.entries(manifest)) {
    const content = contentByHash.get(hash);

    if (content === undefined) {
      return null;
    }

    files[path] = content;
  }

  return files;
}

/**
 * Day 17 — load ONE SPECIFIC version's snapshot from the server (manifest + presigned blob
 * GETs). Used by the per-message Revert flow and the history dropdown. Unlike loadSnapshot,
 * this never touches the IndexedDB cache: the cache holds only the LATEST version, and an
 * older version must neither be served from it nor overwrite it. Returns null on any failure
 * so callers can fall back to message replay.
 */
export async function loadSnapshotVersion(chatId: string, versionNumber: number): Promise<Snapshot | null> {
  let payload: LatestVersionResponse;

  try {
    const res = await fetch(`/api/chats/${chatId}/version/${versionNumber}`);

    if (!res.ok) {
      return null;
    }

    payload = (await res.json()) as LatestVersionResponse;
  } catch {
    return null;
  }

  if (payload.version === null || !payload.manifest || !payload.urls) {
    return null;
  }

  const contentByHash = new Map<string, string>();

  try {
    const entries = await Promise.all(
      Object.entries(payload.urls).map(async ([hash, url]) => {
        const blobRes = await fetch(url);

        if (!blobRes.ok) {
          throw new Error(`blob ${hash} GET failed: ${blobRes.status}`);
        }

        return [hash, await blobRes.text()] as const;
      })
    );

    for (const [hash, content] of entries) {
      contentByHash.set(hash, content);
    }
  } catch {
    return null; // any blob failed — don't mount a partial tree
  }

  const files = reconstructFiles(payload.manifest, contentByHash);

  return files ? { manifest: payload.manifest, files } : null;
}

export async function loadSnapshot(chatId: string): Promise<Snapshot | null> {
  const db = await openDatabase();

  /*
   * Always check the server's latest version first. The old code returned the
   * IndexedDB cache unconditionally (cached.version !== null was always true),
   * which meant a stale cache from a previous session was never replaced —
   * the user saw the INITIAL version on refresh instead of the latest.
   *
   * Now: fetch the server's latest version, and use the cache only to skip blob
   * downloads when the version matches. If the server is unreachable, fall back
   * to the cache (offline best-effort).
   */

  // Tier 2 — server manifest + presigned blob GETs.
  let payload: LatestVersionResponse;

  try {
    const res = await fetch(`/api/chats/${chatId}/version/latest`);

    if (!res.ok) {
      // Server error — fall back to cache if available.
      if (db) {
        const cached = await getSnapshot(db, chatId);

        if (cached && cached.files) {
          return { manifest: cached.manifest, files: cached.files };
        }
      }

      return null;
    }

    payload = (await res.json()) as LatestVersionResponse;
  } catch {
    // Server unreachable — fall back to cache if available.
    if (db) {
      const cached = await getSnapshot(db, chatId);

      if (cached && cached.files) {
        return { manifest: cached.manifest, files: cached.files };
      }
    }

    return null; // server unreachable, no cache — fall back to replay
  }

  if (payload.version === null || !payload.manifest || !payload.urls) {
    // No saved version on the server — fall back to cache (maybe a local-only session) or replay.
    if (db) {
      const cached = await getSnapshot(db, chatId);

      if (cached && cached.files) {
        return { manifest: cached.manifest, files: cached.files };
      }
    }

    return null;
  }

  /*
   * Cache check: if the local cache matches the server's version, use the cached
   * files (already downloaded) and skip the blob fetches entirely. This is the
   * fast path — the cache is current, no need to re-download blobs.
   */
  if (db) {
    const cached = await getSnapshot(db, chatId);

    if (cached && cached.version === payload.version && cached.files) {
      return { manifest: cached.manifest, files: cached.files };
    }
  }

  // Cache is stale or missing — download blobs from the server.
  const { manifest, urls } = payload;

  // Download each unique blob once, in parallel (mirrors the Day-7 endpoint's presign fan-out).
  const contentByHash = new Map<string, string>();

  try {
    const entries = await Promise.all(
      Object.entries(urls).map(async ([hash, url]) => {
        const blobRes = await fetch(url);

        if (!blobRes.ok) {
          throw new Error(`blob ${hash} GET failed: ${blobRes.status}`);
        }

        return [hash, await blobRes.text()] as const;
      })
    );

    for (const [hash, content] of entries) {
      contentByHash.set(hash, content);
    }
  } catch {
    return null; // any blob failed — don't mount a partial tree
  }

  const files = reconstructFiles(manifest, contentByHash);

  if (!files) {
    return null;
  }

  // Write back to the local cache for next time. Best-effort: restore still succeeds if this fails.
  if (db) {
    try {
      await setSnapshot(db, {
        chatId,
        version: payload.version,
        manifest,
        files,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // ignore cache-write failures
    }
  }

  return { manifest, files };
}
