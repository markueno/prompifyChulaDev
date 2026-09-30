import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { hashToken } from './token-hash';

/**
 * The property the whole scheme rests on: a stored value must be findable from the token the user
 * presents, and must not itself be usable as that token.
 */
describe('hashToken', () => {
  it('is deterministic, so a lookup can find the row', () => {
    const token = crypto.randomBytes(32).toString('hex');
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('does not return the token, so the stored value is not a working credential', () => {
    /*
     * This is the bug being fixed. Previously the column held the token itself, so reading the
     * database yielded working password-reset links and acceptable invitations.
     */
    const token = crypto.randomBytes(32).toString('hex');
    expect(hashToken(token)).not.toBe(token);
  });

  it('separates tokens that differ by one character', () => {
    expect(hashToken('a'.repeat(64))).not.toBe(hashToken('a'.repeat(63) + 'b'));
  });

  it('produces a 64-character hex digest', () => {
    /*
     * Worth pinning: a plaintext token from randomBytes(32).toString('hex') is ALSO 64 hex chars,
     * which is why the schema migration cannot tell old rows from new ones by inspection and has
     * to be guarded by schema_migrations instead.
     */
    expect(hashToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});
