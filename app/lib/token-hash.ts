import crypto from 'crypto';

/**
 * Hash a single-use credential for storage.
 *
 * Invitation tokens, password-reset tokens and email-verification tokens were all stored in
 * plaintext, while session tokens were already hashed (`auth.ts`). That asymmetry meant anyone who
 * could read the database — a backup, the backup container, a support query, a leaked dump — held
 * working password-reset links for every account and could accept any pending invitation. Reading
 * a database should not be the same as holding the keys.
 *
 * Plain unsalted SHA-256 is the right primitive here, and deliberately not bcrypt. These are
 * 256-bit values from a CSPRNG, not human-chosen passwords: there is no dictionary to attack and
 * no rainbow table to build, so the slow hashing that protects a password buys nothing, while its
 * per-call cost would be paid on every lookup. Unsalted is required rather than merely acceptable —
 * the hash has to be reproducible from the token alone in order to find the row.
 *
 * The invariant this creates: the plaintext exists only in the email that was sent, and in the one
 * response that issued it. It cannot be recovered afterwards, by us or by anyone else.
 *
 * NOT under .server/ despite being server-only by intent. Remix refuses a value import from a
 * .server module in anything reachable from the client bundle, and database-postgresql.ts is
 * reachable — routes import personalCompanyId from it. Putting it there broke the production
 * build while passing typecheck, lint and tests, none of which model bundler boundaries. It is
 * safe here regardless: SHA-256 of a caller-supplied string holds no secret, and auth.ts already
 * imports crypto from a client-reachable module for the same reason.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
