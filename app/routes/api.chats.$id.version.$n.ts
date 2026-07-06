import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getChatByIdPostgres, getCodebaseVersionPostgres } from '~/lib/database-postgresql';
import { keyForHash, getPresignedGetUrl } from '~/lib/.server/storage';

/*
 * GET /api/chats/:id/version/:n   (Day 17)
 *
 * Response: { version: number, manifest: {path: sha256}, urls: {sha256: getUrl} }
 * 404 when the version doesn't exist.
 *
 * Specific-version sibling of /version/latest — used by the per-message Revert flow (restore
 * the codebase mapped to a message) and the history dropdown's restore preview. Same
 * flag/auth/ownership pattern; presigned GET URLs so the client downloads blobs directly.
 */
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  if (process.env.SNAPSHOTS_ENABLED !== 'true') {
    return json({ error: 'Not found' }, { status: 404 });
  }

  // requireAuth throws a redirect Response when unauthenticated — keep it outside try/catch.
  const user = await requireAuth(request, context);

  try {
    const chatId = params.id;
    const versionNumber = Number(params.n);

    if (!chatId) {
      return json({ error: 'chatId is required' }, { status: 400 });
    }

    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      return json({ error: 'version must be a positive integer' }, { status: 400 });
    }

    const chat = await getChatByIdPostgres(chatId, user.id, user.isModerator);

    if (!chat) {
      return json({ error: 'Not found' }, { status: 404 });
    }

    const version = await getCodebaseVersionPostgres(chat.id, versionNumber);

    if (!version) {
      return json({ error: 'Not found' }, { status: 404 });
    }

    // One presigned GET per unique blob (paths sharing a blob reuse the same URL).
    const hashes = [...new Set(Object.values(version.manifest))];
    const entries = await Promise.all(
      hashes.map(async hash => [hash, await getPresignedGetUrl(keyForHash(hash), 60)] as const)
    );
    const urls = Object.fromEntries(entries);

    return json({ version: version.versionNumber, manifest: version.manifest, urls });
  } catch (error) {
    console.error('Error loading version:', error);
    return json({ error: 'Failed to load version' }, { status: 500 });
  }
}
