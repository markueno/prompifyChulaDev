/**
 * Download a project's actual source as a ZIP, from the project list, without opening it.
 *
 * `workbenchStore.downloadZip()` already makes a proper ZIP, but it reads the live WebContainer
 * file map — which only exists once a project has been opened in the workbench. From the list
 * nothing is open, so there is nothing there to zip.
 *
 * The snapshot subsystem solves it. `codebase_versions.manifest` is a COMPLETE {path: sha256} map
 * of every file, rewritten in full on each save rather than kept as a delta, so any single version
 * is self-sufficient. `GET /api/chats/:id/version/latest` hands back that manifest plus a
 * short-lived presigned GET per unique blob — so the browser reassembles the project straight from
 * object storage, and the app server does no work beyond the one manifest read.
 *
 * Deliberately NOT via loadSnapshot(): that consults the per-tab IndexedDB cache, which is keyed
 * by a session token and holds only the latest version of a project opened *in this tab*. Exporting
 * from the list would always miss it, and a hit could serve something staler than the server's copy.
 */
import JSZip from 'jszip';
import fileSaver from 'file-saver';
import { isBinary } from 'istextorbinary';
import { reconstructFiles, snapshotPathToRelative } from '~/lib/snapshots/loadSnapshot';

const { saveAs } = fileSaver;

export type ExportResult = { ok: true; fileCount: number } | { ok: false; reason: 'no-code' | 'failed' };

interface LatestVersionResponse {
  version: number | null;
  manifest?: Record<string, string>;
  urls?: Record<string, string>;
}

export interface ZipEntry {
  path: string;
  content: string | Uint8Array;
}

/**
 * What the ZIP cannot contain, said once in the ZIP itself.
 *
 * The specific omitted files cannot be named: buildSnapshot skips oversized binaries with a bare
 * `continue`, so neither the manifest nor the version row records that they existed. Rather than
 * imply completeness by saying nothing, the export states its own limits — and answers the
 * question someone will actually have, which is where node_modules went.
 */
const EXPORT_NOTES = `This is the source of your Prompify project, exported from its most recently
saved state.

Not included:

  * node_modules  - run "npm install" to restore it
  * .git          - never captured
  * binary files over ~1MB (large images, fonts, media)

To run it locally:

  npm install
  npm run dev
`;

/**
 * Turn a reconstructed {absolutePath: content} map into entries ready for a ZIP.
 *
 * Pure, so the awkward part is testable without a network or a zip. Two things are easy to get
 * wrong here and both are silent:
 *
 * 1. Binary files are stored base64-encoded AS TEXT, and the manifest carries no binary flag — so
 *    binariness has to be re-derived from the path, exactly as the workbench restore does. Miss
 *    this and every image in the ZIP is a text file full of base64.
 * 2. Manifest paths are absolute WebContainer paths (/home/project-<session>/src/App.tsx) and the
 *    prefix differs per session, so it has to be stripped generically rather than matched.
 */
export function planZipEntries(files: Record<string, string>): ZipEntry[] {
  const entries: ZipEntry[] = [];

  for (const [absolutePath, content] of Object.entries(files)) {
    const path = snapshotPathToRelative(absolutePath);

    // An empty path would mean the entry was the workdir itself; nothing to write.
    if (!path) {
      continue;
    }

    if (isBinary(path, null) === true) {
      try {
        entries.push({ path, content: Uint8Array.from(atob(content), c => c.charCodeAt(0)) });
        continue;
      } catch {
        /*
         * Not valid base64 after all — the path looked binary but the content is text. Fall
         * through and write it as text rather than dropping the file.
         */
      }
    }

    entries.push({ path, content });
  }

  return entries;
}

/** `my project` -> `my_project_k3x9fa`, matching workbenchStore.downloadZip's convention. */
function zipFileName(projectName: string): string {
  const base = (projectName || 'project').toLocaleLowerCase().split(' ').join('_');

  // A short timestamp hash, so exporting one project twice does not collide in a downloads folder.
  return `${base}_${Date.now().toString(36).slice(-6)}.zip`;
}

export async function downloadProjectZip(chatId: string, projectName: string): Promise<ExportResult> {
  let payload: LatestVersionResponse;

  try {
    const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/version/latest`);

    /*
     * A 404 here is not only "no such project" — the route 404s outright when SNAPSHOTS_ENABLED is
     * off. Either way there is nothing to hand the user, and neither is the "never saved" case
     * below, which is ordinary rather than a failure.
     */
    if (!res.ok) {
      return { ok: false, reason: 'failed' };
    }

    payload = (await res.json()) as LatestVersionResponse;
  } catch {
    return { ok: false, reason: 'failed' };
  }

  if (payload.version === null || !payload.manifest || !payload.urls) {
    return { ok: false, reason: 'no-code' };
  }

  const contentByHash = new Map<string, string>();

  try {
    const downloaded = await Promise.all(
      Object.entries(payload.urls).map(async ([hash, url]) => {
        const blobRes = await fetch(url);

        if (!blobRes.ok) {
          throw new Error(`blob ${hash} GET failed: ${blobRes.status}`);
        }

        return [hash, await blobRes.text()] as const;
      })
    );

    for (const [hash, content] of downloaded) {
      contentByHash.set(hash, content);
    }
  } catch {
    return { ok: false, reason: 'failed' };
  }

  /*
   * All-or-nothing, the same policy the workbench restore uses: reconstructFiles returns null if
   * any referenced blob is missing. A ZIP silently short a few files is worse than a clear failure,
   * because the person only finds out when the project will not build.
   */
  const files = reconstructFiles(payload.manifest, contentByHash);

  if (!files) {
    return { ok: false, reason: 'failed' };
  }

  const entries = planZipEntries(files);

  if (entries.length === 0) {
    return { ok: false, reason: 'no-code' };
  }

  const zip = new JSZip();

  for (const entry of entries) {
    // JSZip creates intermediate folders from a path containing slashes.
    zip.file(entry.path, entry.content);
  }

  zip.file('EXPORT-NOTES.txt', EXPORT_NOTES);

  try {
    saveAs(await zip.generateAsync({ type: 'blob' }), zipFileName(projectName));
  } catch {
    return { ok: false, reason: 'failed' };
  }

  return { ok: true, fileCount: entries.length };
}
