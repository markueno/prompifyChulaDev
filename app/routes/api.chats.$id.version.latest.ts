import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getChatByIdPostgres, getLatestCodebaseVersionPostgres } from '~/lib/database-postgresql';
import { keyForHash, getPresignedGetUrl } from '~/lib/.server/storage';

/*
 * GET /api/chats/:id/version/latest
 *
 * Response (saved):      { version: number, manifest: {path: sha256}, urls: {sha256: getUrl} }
 * Response (never saved): { version: null }   // client falls back to message replay (Tier 3)
 *
 * Returns the latest version's manifest plus a 60s presigned GET URL per unique blob, so the
 * client downloads file contents directly from object storage. Read-only; gated behind
 * SNAPSHOTS_ENABLED with the same ownership check as the save route.
 * Source: ARCHITECTURE-v2.md:411-413, 424; IMPLEMENTATION-PLAN Day 7.
 */
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  if (process.env.SNAPSHOTS_ENABLED !== 'true') {
    return json({ error: 'Not found' }, { status: 404 });
  }

  // requireAuth throws a redirect Response when unauthenticated — keep it outside try/catch.
  const user = await requireAuth(request, context);

  try {
    const chatId = params.id;

    if (!chatId) {
      return json({ error: 'chatId is required' }, { status: 400 });
    }

    const chat = await getChatByIdPostgres(chatId, user.id, user.isModerator);

    if (!chat) {
      return json({ error: 'Not found' }, { status: 404 });
    }

    const latest = await getLatestCodebaseVersionPostgres(chat.id);

    if (!latest) {
      return json({ version: null });
    }

    // One presigned GET per unique blob (paths sharing a blob reuse the same URL).
    const hashes = [...new Set(Object.values(latest.manifest))];
    const entries = await Promise.all(
      hashes.map(async hash => [hash, await getPresignedGetUrl(keyForHash(hash), 60)] as const)
    );
    const urls = Object.fromEntries(entries);

    return json({ version: latest.versionNumber, manifest: latest.manifest, urls });
  } catch (error) {
    console.error('Error loading latest version:', error);
    return json({ error: 'Failed to load version' }, { status: 500 });
  }
}
