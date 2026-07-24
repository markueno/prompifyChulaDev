/*
 * app/lib/snapshots/buildSnapshot.ts
 *
 * Pure, deterministic snapshot builder: turns WorkbenchStore file state (a FileMap)
 * into { manifest: {path: sha256}, files: {path: content} }. No network, no DB — the
 * content-addressed source every snapshot op consumes. Imported by nothing yet (Day 3).
 * Source: ARCHITECTURE-v2.md:340-346, 378-379; IMPLEMENTATION-PLAN Day 3.
 */
import { isBinary } from 'istextorbinary';
import type { FileMap } from '~/lib/stores/files';

export interface Snapshot {
  /** Map of file path -> SHA-256 hex of its content. */
  manifest: Record<string, string>;
  /** Map of file path -> raw file content (the actual bytes to upload/restore). */
  files: Record<string, string>;
}

// Exclude these directories entirely — never snapshotted. ARCHITECTURE-v2.md:342.
const EXCLUDED_DIRS = ['node_modules', '.git'];

// Skip binary files larger than this; keeps snapshots small. ARCHITECTURE-v2.md:342.
const MAX_BINARY_BYTES = 1024 * 1024; // 1MB

function isExcludedPath(path: string): boolean {
  // Match the dir as any path segment: `node_modules/x`, `/home/project/.git/config`, etc.
  const segments = path.split('/');

  return EXCLUDED_DIRS.some(dir => segments.includes(dir));
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';

  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }

  return hex;
}

/**
 * Build a content-addressed snapshot from the current file map.
 * Deterministic: same input always yields the same manifest hashes.
 */
export async function buildSnapshot(files: FileMap): Promise<Snapshot> {
  const manifest: Record<string, string> = {};
  const snapshotFiles: Record<string, string> = {};
  const encoder = new TextEncoder();

  for (const [path, dirent] of Object.entries(files)) {
    // Skip folders, deleted entries (undefined), and excluded dirs.
    if (!dirent || dirent.type !== 'file') {
      continue;
    }

    if (isExcludedPath(path)) {
      continue;
    }

    /*
     * Detect binary: prefer the FilesStore flag (content-based), fall back to
     * path-extension check (catches files the watcher didn't classify as binary).
     */
    const isBinaryFile = dirent.isBinary || isBinary(path, null) === true;

    const bytes = encoder.encode(dirent.content);

    if (isBinaryFile && bytes.byteLength > MAX_BINARY_BYTES) {
      continue;
    }

    const digest = await crypto.subtle.digest('SHA-256', bytes);
    manifest[path] = toHex(digest);
    snapshotFiles[path] = dirent.content;
  }

  return { manifest, files: snapshotFiles };
}
