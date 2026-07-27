/*
 * app/lib/snapshots/uploadBlobs.ts
 *
 * Client-side blob uploader: for each missing hash, request a presigned PUT URL
 * from /api/snapshots/upload-url and PUT the content directly to object storage.
 * Consumes the `missing` list from the dedup endpoint (Day 4) and a Snapshot
 * (Day 3). Wired into the save flow on Day 9.
 * Source: ARCHITECTURE-v2.md:356; IMPLEMENTATION-PLAN Day 5.
 */
import type { Snapshot } from './buildSnapshot';

/**
 * Upload the blobs identified by `missing` (SHA-256 hashes) to object storage.
 * Only hashes present in the snapshot are uploaded; unknown hashes are skipped.
 */
export async function uploadBlobs(snapshot: Snapshot, missing: string[]): Promise<void> {
  if (missing.length === 0) {
    return;
  }

  // Map each content hash to its content (first path that produced it).
  const contentByHash = new Map<string, string>();

  for (const [path, hash] of Object.entries(snapshot.manifest)) {
    if (!contentByHash.has(hash)) {
      contentByHash.set(hash, snapshot.files[path]);
    }
  }

  const encoder = new TextEncoder();

  for (const hash of missing) {
    const content = contentByHash.get(hash);

    if (content === undefined) {
      continue; // hash not part of this snapshot — skip defensively
    }

    const size = encoder.encode(content).byteLength;

    const urlRes = await fetch('/api/snapshots/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash, size }),
    });

    if (!urlRes.ok) {
      throw new Error(`Failed to get upload URL for ${hash}: ${urlRes.status}`);
    }

    const { url } = (await urlRes.json()) as { url: string };

    const putRes = await fetch(url, { method: 'PUT', body: content });

    if (!putRes.ok) {
      throw new Error(`Failed to upload blob ${hash}: ${putRes.status}`);
    }
  }
}
