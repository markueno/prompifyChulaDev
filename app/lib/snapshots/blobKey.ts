/**
 * Where a blob lives in object storage, derived from its content hash.
 *
 * Pure string maths, split out of `.server/storage` so it can be imported from anywhere. That
 * module also holds the S3 client and its credentials, which genuinely must never reach a client
 * bundle — but Remix enforces that per MODULE, not per export, so keeping this one-liner there
 * meant `database-postgresql.ts` (reachable from the client, since routes import
 * `personalCompanyId` from it) had to make a value import from a `.server/` path. That fails the
 * production build while passing typecheck, lint and tests, none of which model bundler
 * boundaries.
 *
 * `.server/storage` re-exports this, so nothing that already imported it from there has to change.
 */

/**
 * Content-addressed key: blobs/<sha[0:2]>/<sha[2:4]>/<sha>
 * Fans files across prefixes so no single prefix becomes hot. ARCHITECTURE-v2.md:154.
 */
export function keyForHash(sha256: string): string {
  return `blobs/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}
