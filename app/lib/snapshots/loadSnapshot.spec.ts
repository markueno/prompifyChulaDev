import { describe, expect, it } from 'vitest';
import { reconstructFiles } from './loadSnapshot';

describe('reconstructFiles', () => {
  it('maps each manifest path to its blob content', () => {
    const manifest = { 'src/a.txt': 'h1', 'src/b.txt': 'h2' };
    const contentByHash = new Map([
      ['h1', 'hello'],
      ['h2', 'world'],
    ]);

    expect(reconstructFiles(manifest, contentByHash)).toEqual({
      'src/a.txt': 'hello',
      'src/b.txt': 'world',
    });
  });

  it('reuses one blob for multiple paths sharing a hash (dedup)', () => {
    const manifest = { 'a/package.json': 'shared', 'b/package.json': 'shared' };
    const contentByHash = new Map([['shared', '{}']]);

    expect(reconstructFiles(manifest, contentByHash)).toEqual({
      'a/package.json': '{}',
      'b/package.json': '{}',
    });
  });

  it('returns null when a referenced hash is missing (no partial restore)', () => {
    const manifest = { 'src/a.txt': 'h1', 'src/b.txt': 'missing' };
    const contentByHash = new Map([['h1', 'hello']]);

    expect(reconstructFiles(manifest, contentByHash)).toBeNull();
  });

  it('returns an empty map for an empty manifest', () => {
    expect(reconstructFiles({}, new Map())).toEqual({});
  });
});
