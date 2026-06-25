/*
 * app/lib/snapshots/versionMeta.ts
 *
 * Pure helper: derive version metadata (file count, total bytes, unique blob hashes)
 * from a manifest (path -> sha256) and a per-blob size map (sha256 -> bytes).
 * Used by the transactional version-save (Day 6). No network, no DB.
 */
export interface VersionMeta {
  fileCount: number;
  totalBytes: number;
  hashes: string[]; // unique sha256s referenced by the manifest
}

export function computeVersionMeta(manifest: Record<string, string>, blobSizes: Record<string, number>): VersionMeta {
  const paths = Object.keys(manifest);
  const hashes = [...new Set(Object.values(manifest))];

  // total_bytes = logical project size (counts a path's bytes even if the blob is shared).
  const totalBytes = paths.reduce((sum, path) => sum + (blobSizes[manifest[path]] ?? 0), 0);

  return { fileCount: paths.length, totalBytes, hashes };
}
