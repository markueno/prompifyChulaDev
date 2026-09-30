import { describe, it, expect } from 'vitest';
import { planZipEntries } from './projectExport';

/**
 * planZipEntries holds the two things about this export that fail silently.
 *
 * Binary files are stored base64-encoded as text and the manifest carries no binary flag, so
 * binariness is re-derived from the path. Get it wrong and every image in the ZIP is a text file
 * full of base64 — which nobody notices until they open the ZIP. And manifest paths are absolute
 * WebContainer paths whose prefix differs per session, so a missed strip puts the whole project
 * inside a `home/project-xyz/` folder.
 *
 * Pure, so none of this needs a network or a zip.
 */

// A 1x1 transparent GIF, the shortest real binary that survives a base64 round trip.
const GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

describe('planZipEntries', () => {
  it('decodes a base64 binary file back to real bytes', () => {
    const [entry] = planZipEntries({ '/home/project-abc/public/pixel.gif': GIF_BASE64 });

    expect(entry.path).toBe('public/pixel.gif');
    expect(entry.content).toBeInstanceOf(Uint8Array);

    // GIF magic number — proof it is the decoded image and not the base64 text.
    const bytes = entry.content as Uint8Array;
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2])).toBe('GIF');
  });

  it('leaves a text file exactly as it was', () => {
    const source = 'export const answer = 42;\n';
    const [entry] = planZipEntries({ '/home/project-abc/src/answer.ts': source });

    expect(entry.path).toBe('src/answer.ts');
    expect(entry.content).toBe(source);
  });

  it('strips the workdir prefix whatever the session name is', () => {
    /*
     * The prefix is per-session, so a project exported in a different browser than it was built in
     * carries a name this code has never seen. It must not be matched against anything known.
     */
    const entries = planZipEntries({
      '/home/project-abc/package.json': '{}',
      '/home/project-completely-different-999/vite.config.ts': 'export default {};',
    });

    expect(entries.map(e => e.path).sort()).toEqual(['package.json', 'vite.config.ts']);
  });

  it('passes an already-relative path through untouched', () => {
    const [entry] = planZipEntries({ 'src/main.tsx': 'x' });

    expect(entry.path).toBe('src/main.tsx');
  });

  it('keeps a file whose extension looks binary but whose content is not base64', () => {
    /*
     * Falling back to text rather than dropping the file: a mislabelled extension should cost the
     * person a slightly odd file in the ZIP, not a missing one.
     */
    const [entry] = planZipEntries({ '/home/project-abc/notes.png': 'this is not base64 !!!' });

    expect(entry.path).toBe('notes.png');
    expect(entry.content).toBe('this is not base64 !!!');
  });

  it('drops an entry that is only the workdir itself', () => {
    expect(planZipEntries({ '/home/project-abc/': '' })).toEqual([]);
  });
});
