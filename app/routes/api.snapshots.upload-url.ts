import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { keyForHash, getPresignedPutUrl } from '~/lib/.server/storage';

/*
 * POST /api/snapshots/upload-url
 *
 * Body: { hash: string, size: number }  ->  Response: { url: string }
 * Issues a 60-second presigned PUT URL so the client can upload one blob directly
 * to object storage. The storage key is DERIVED on the server from the hash
 * (keyForHash) — the client never supplies a key, which prevents path traversal.
 * Gated behind SNAPSHOTS_ENABLED.
 * Source: ARCHITECTURE-v2.md:354-357; IMPLEMENTATION-PLAN Day 5.
 */
const SHA256_RE = /^[a-f0-9]{64}$/;
const MAX_BLOB_BYTES = 25 * 1024 * 1024; // 25MB sanity cap on a single blob

export async function action({ request, context }: ActionFunctionArgs) {
  // Flag gate: when off, the endpoint does not exist (no auth, no signing).
  if (process.env.SNAPSHOTS_ENABLED !== 'true') {
    return json({ error: 'Not found' }, { status: 404 });
  }

  /*
   * requireAuth throws a redirect Response when unauthenticated — keep it OUTSIDE
   * the try/catch so it propagates to Remix instead of being turned into a 500.
   */
  await requireAuth(request, context);

  try {
    const body = (await request.json()) as { hash?: unknown; size?: unknown };
    const hash = typeof body.hash === 'string' ? body.hash : '';
    const size = typeof body.size === 'number' ? body.size : NaN;

    if (!SHA256_RE.test(hash)) {
      return json({ error: 'Invalid hash' }, { status: 400 });
    }

    // size 0 is valid: empty files are real content (sha256 e3b0c4…855) and must round-trip.
    if (!Number.isInteger(size) || size < 0 || size > MAX_BLOB_BYTES) {
      return json({ error: 'Invalid size' }, { status: 400 });
    }

    const url = await getPresignedPutUrl(keyForHash(hash), 60);

    return json({ url });
  } catch (error) {
    console.error('Error in snapshots upload-url:', error);
    return json({ error: 'Failed to create upload URL' }, { status: 500 });
  }
}
