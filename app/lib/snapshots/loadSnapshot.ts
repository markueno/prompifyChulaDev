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

/*
 * Per-page-load session token — distinguishes cache writes from the CURRENT page
 * session (safe to serve) from a PREVIOUS session (stale — bypass + download fresh
 * from the server). Generated once per page load; passed to setSnapshot so the
 * cache-match check can compare.
 */
const SESSION_TOKEN = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

function getSessionToken(): string {
  return SESSION_TOKEN;
}

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
      console.warn(`[loadSnapshot] server error (${res.status}), falling back to cache`);

      if (db) {
        const cached = await getSnapshot(db, chatId);

        if (cached && cached.files) {
          console.warn('[loadSnapshot] served from cache (server was down)');
          return { manifest: cached.manifest, files: cached.files };
        }
      }

      console.warn('[loadSnapshot] no cache available, returning null → replay');

      return null;
    }

    payload = (await res.json()) as LatestVersionResponse;
  } catch (error) {
    // Server unreachable — fall back to cache if available.
    console.warn('[loadSnapshot] server unreachable, falling back to cache:', error);

    if (db) {
      const cached = await getSnapshot(db, chatId);

      if (cached && cached.files) {
        console.warn('[loadSnapshot] served from cache (server unreachable)');
        return { manifest: cached.manifest, files: cached.files };
      }
    }

    console.warn('[loadSnapshot] no cache available, returning null → replay');

    return null; // server unreachable, no cache — fall back to replay
  }

  if (payload.version === null || !payload.manifest || !payload.urls) {
    // No saved version on the server — fall back to cache (maybe a local-only session) or replay.
    console.warn(
      `[loadSnapshot] no saved version on server (version: ${payload.version}, manifest: ${!!payload.manifest}, urls: ${!!payload.urls}), falling back to cache/replay`
    );

    if (db) {
      const cached = await getSnapshot(db, chatId);

      if (cached && cached.files) {
        console.warn('[loadSnapshot] served from cache (no server version)');
        return { manifest: cached.manifest, files: cached.files };
      }
    }

    console.warn('[loadSnapshot] no cache available, returning null → replay');

    return null;
  }

  /*
   * Cache check: if the local cache matches the server's version, use the cached
   * files (already downloaded) and skip the blob fetches entirely. This is the
   * fast path — the cache is current, no need to re-download blobs.
   *
   * STALE-CACHE GUARD: the cache could have been written by a PREVIOUS page
   * session (e.g., the pagehide flush wrote it, then the user refreshed). In that
   * case the cache's files might be from a mid-edit state, not the server's true
   * latest. We track the current page load with a session token — if the cache's
   * session token doesn't match, we bypass the cache and download fresh from the
   * server (the server is authoritative).
   */
  const currentSession = getSessionToken();

  if (db) {
    const cached = await getSnapshot(db, chatId);

    if (cached && cached.version === payload.version && cached.files) {
      // Check if the cache was written in THIS page session (not a previous one).
      const cacheSession = (cached as any).sessionToken as string | undefined;

      if (cacheSession === currentSession) {
        console.log(`[loadSnapshot] restored version ${payload.version} from cache-match (same session)`);
        return { manifest: cached.manifest, files: cached.files };
      }

      console.warn(
        `[loadSnapshot] cache version ${payload.version} matches server but is from a previous session — bypassing cache, downloading fresh from server`
      );
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
  } catch (error) {
    console.warn('[loadSnapshot] blob download failed (will fall back to replay):', error);
    return null; // any blob failed — don't mount a partial tree
  }

  const files = reconstructFiles(manifest, contentByHash);

  if (!files) {
    console.warn('[loadSnapshot] reconstructFiles returned null (missing blob content)');
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
        /*
         * Tag the cache entry with the current page-load session token so the
         * cache-match check can distinguish same-session (safe) from cross-session
         * (stale — bypass + download fresh).
         */
        sessionToken: currentSession,
      } as any);
    } catch {
      // ignore cache-write failures
    }
  }

  console.log(`[loadSnapshot] restored version ${payload.version} from server-download`);

  return { manifest, files };
}
