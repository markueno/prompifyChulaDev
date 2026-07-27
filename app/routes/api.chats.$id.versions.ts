import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getChatByIdPostgres, listCodebaseVersionsPostgres } from '~/lib/database-postgresql';

/*
 * GET /api/chats/:id/versions   (Day 15)
 *
 * Response: { versions: [{ versionNumber, description, fileCount, totalBytes, isLatest,
 *                          createdAt }] }  — newest first, at most 50.
 *
 * Metadata only (no manifests, no presigned URLs): this feeds the version-history panel
 * (Days 16-17); restoring a specific version fetches its content separately. Read-only,
 * gated behind SNAPSHOTS_ENABLED, with the same ownership check as the other version routes.
 * Source: ARCHITECTURE-v2.md:450-458; IMPLEMENTATION-PLAN Day 15.
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

    const versions = await listCodebaseVersionsPostgres(chat.id);

    return json({ versions });
  } catch (error) {
    console.error('Error listing versions:', error);
    return json({ error: 'Failed to list versions' }, { status: 500 });
  }
}
