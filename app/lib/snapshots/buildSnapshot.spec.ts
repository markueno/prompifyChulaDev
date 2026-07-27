import { describe, expect, it } from 'vitest';
import type { FileMap } from '~/lib/stores/files';
import { buildSnapshot } from './buildSnapshot';

describe('buildSnapshot', () => {
  it('hashes file content with SHA-256 and preserves content', async () => {
    const files: FileMap = {
      'src/a.txt': { type: 'file', content: 'hello', isBinary: false },
      'src/b.txt': { type: 'file', content: 'abc', isBinary: false },
    };

    const snap = await buildSnapshot(files);

    // Known SHA-256 test vectors.
    expect(snap.manifest['src/a.txt']).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(snap.manifest['src/b.txt']).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(snap.files['src/a.txt']).toBe('hello');
  });

  it('excludes node_modules, .git, folders, and deleted entries', async () => {
    const files: FileMap = {
      'node_modules/pkg/index.js': { type: 'file', content: 'x', isBinary: false },
      '.git/config': { type: 'file', content: 'y', isBinary: false },
      src: { type: 'folder' },
      'gone.txt': undefined,
      'keep.txt': { type: 'file', content: 'hello', isBinary: false },
    };

    const snap = await buildSnapshot(files);

    expect(Object.keys(snap.manifest)).toEqual(['keep.txt']);
  });

  it('excludes binary files larger than 1MB but keeps small ones', async () => {
    const files: FileMap = {
      'big.bin': { type: 'file', content: 'x'.repeat(1024 * 1024 + 1), isBinary: true },
      'small.bin': { type: 'file', content: 'small', isBinary: true },
    };

    const snap = await buildSnapshot(files);

    expect(snap.manifest['big.bin']).toBeUndefined();
    expect(snap.manifest['small.bin']).toBeDefined();
  });
});
