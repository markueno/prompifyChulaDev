import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getPostgresPool } from '~/lib/database-postgresql';

/*
 * POST /api/snapshots/dedup
 *
 * Body: { hashes: string[] }  ->  Response: { missing: string[] }
 * Returns the subset of hashes NOT already present in codebase_blobs, so the
 * client only uploads new blobs. Gated behind SNAPSHOTS_ENABLED — when off the
 * route 404s and the system behaves exactly as before.
 * Source: ARCHITECTURE-v2.md:348-351; IMPLEMENTATION-PLAN Day 4.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  // Flag gate first: when off, the endpoint does not exist (no auth, no DB touched).
  if (process.env.SNAPSHOTS_ENABLED !== 'true') {
    return json({ error: 'Not found' }, { status: 404 });
  }

  /*
   * requireAuth throws a redirect Response when unauthenticated — keep it OUTSIDE
   * the try/catch so it propagates to Remix instead of being turned into a 500.
   */
  await requireAuth(request, context);

  try {
    const body = (await request.json()) as { hashes?: unknown };
    const hashes = Array.isArray(body.hashes) ? body.hashes.filter((h): h is string => typeof h === 'string') : [];

    if (hashes.length === 0) {
      return json({ missing: [] });
    }

    const pool = getPostgresPool();
    const result = await pool.query<{ sha256: string }>('SELECT sha256 FROM codebase_blobs WHERE sha256 = ANY($1)', [
      hashes,
    ]);

    const existing = new Set(result.rows.map(row => row.sha256));
    const missing = hashes.filter(hash => !existing.has(hash));

    return json({ missing });
  } catch (error) {
    console.error('Error in snapshots dedup:', error);
    return json({ error: 'Failed to process dedup' }, { status: 500 });
  }
}
