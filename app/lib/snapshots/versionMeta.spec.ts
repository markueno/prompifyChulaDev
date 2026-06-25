import { describe, expect, it } from 'vitest';
import { computeVersionMeta } from './versionMeta';

describe('computeVersionMeta', () => {
  it('counts files, sums bytes, and dedups hashes', () => {
    const manifest = {
      'src/a.ts': 'aaa',
      'src/b.ts': 'bbb',
      'src/c.ts': 'aaa', // shares the blob with a.ts
    };
    const blobSizes = { aaa: 100, bbb: 50 };

    const meta = computeVersionMeta(manifest, blobSizes);

    expect(meta.fileCount).toBe(3);
    expect(meta.hashes.sort()).toEqual(['aaa', 'bbb']); // unique blobs only
    expect(meta.totalBytes).toBe(250); // 100 (a) + 50 (b) + 100 (c, shared blob)
  });

  it('treats missing sizes as 0 and handles an empty manifest', () => {
    expect(computeVersionMeta({}, {})).toEqual({ fileCount: 0, totalBytes: 0, hashes: [] });
    expect(computeVersionMeta({ 'x.ts': 'zzz' }, {})).toEqual({
      fileCount: 1,
      totalBytes: 0,
      hashes: ['zzz'],
    });
  });
});
