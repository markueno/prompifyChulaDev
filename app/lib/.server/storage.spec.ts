// app/lib/.server/storage.spec.ts
import { describe, expect, it } from 'vitest';
import { keyForHash } from './storage';

describe('storage.keyForHash', () => {
  it('derives a content-addressed key: blobs/<2>/<2>/<sha>', () => {
    const sha = 'abc123def456abc123def456abc123def456abc123def456abc123def4561234';
    expect(keyForHash(sha)).toBe(`blobs/ab/c1/${sha}`);
  });

  it('fans out by the first two byte-pairs', () => {
    const sha = 'ff00112233445566778899aabbccddeeff00112233445566778899aabbccddee';
    expect(keyForHash(sha)).toBe(`blobs/ff/00/${sha}`);
  });
});
