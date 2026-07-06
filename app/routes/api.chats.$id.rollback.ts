import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getChatByIdPostgres, rollbackCodebaseVersionPostgres } from '~/lib/database-postgresql';

/*
 * POST /api/chats/:id/rollback?version=N   (Day 16)
 *
 * Response: { version: number }  — the NEW version number created by the rollback.
 *
 * Rollback is append-only: it copies version N's manifest into a brand-new latest version
 * (history is never mutated; you can roll back from a rollback). After this call the client
 * refetches /api/chats/:id/version/latest to remount the restored files (Day 17).
 * Flag-gated + ownership-checked exactly like the other version routes.
 * Source: ARCHITECTURE-v2.md:461-497; IMPLEMENTATION-PLAN Day 16.
 */
export async function action({ request, context, params }: ActionFunctionArgs) {
  if (process.env.SNAPSHOTS_ENABLED !== 'true') {
    return json({ error: 'Not found' }, { status: 404 });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  // requireAuth throws a redirect Response when unauthenticated — keep it outside try/catch.
  const user = await requireAuth(request, context);

  try {
    const chatId = params.id;

    if (!chatId) {
      return json({ error: 'chatId is required' }, { status: 400 });
    }

    const versionParam = new URL(request.url).searchParams.get('version');
    const targetVersion = Number(versionParam);

    if (!versionParam || !Number.isInteger(targetVersion) || targetVersion < 1) {
      return json({ error: 'version must be a positive integer' }, { status: 400 });
    }

    const chat = await getChatByIdPostgres(chatId, user.id, user.isModerator);

    if (!chat) {
      return json({ error: 'Not found' }, { status: 404 });
    }

    const newVersion = await rollbackCodebaseVersionPostgres(chat.id, user.id, targetVersion);

    if (newVersion === null) {
      return json({ error: `Version ${targetVersion} does not exist` }, { status: 404 });
    }

    return json({ version: newVersion });
  } catch (error) {
    console.error('Error rolling back version:', error);
    return json({ error: 'Failed to rollback' }, { status: 500 });
  }
}
