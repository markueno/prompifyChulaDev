import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getChatByIdPostgres, saveCodebaseVersionPostgres } from '~/lib/database-postgresql';

/*
 * POST /api/chats/:id/version
 *
 * Body: { manifest: {path: sha256}, blobs: {sha256: sizeBytes}, description?: string }
 * Response: { ok: true, version: number }
 *
 * Saves a new codebase version for the chat in ONE transaction (FOR UPDATE lock,
 * flip is_latest, insert version, bump/insert blob ref_counts). Gated behind
 * SNAPSHOTS_ENABLED and an ownership check.
 * Source: ARCHITECTURE-v2.md:359-392; IMPLEMENTATION-PLAN Day 6.
 */
const SHA256_RE = /^[a-f0-9]{64}$/;

export async function action({ request, context, params }: ActionFunctionArgs) {
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

    // Ownership: reuse the existing access query; null => no access (or no such chat).
    const chat = await getChatByIdPostgres(chatId, user.id, user.isModerator);

    if (!chat) {
      return json({ error: 'Not found' }, { status: 404 });
    }

    const body = (await request.json()) as {
      manifest?: Record<string, string>;
      blobs?: Record<string, number>;
      description?: string;
      messageId?: string;
    };

    const { manifest } = body;

    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return json({ error: 'Invalid manifest' }, { status: 400 });
    }

    // Validate every referenced hash is a real sha256 (guards the DB-derived storage key).
    for (const sha of Object.values(manifest)) {
      if (typeof sha !== 'string' || !SHA256_RE.test(sha)) {
        return json({ error: 'Invalid manifest hash' }, { status: 400 });
      }
    }

    const blobSizes = body.blobs && typeof body.blobs === 'object' && !Array.isArray(body.blobs) ? body.blobs : {};

    const version = await saveCodebaseVersionPostgres({
      chatId: chat.id, // canonical id (getChatByIdPostgres resolves id-or-url_id)
      userId: user.id,
      manifest,
      blobSizes,
      description: typeof body.description === 'string' ? body.description : undefined,
      // Day 17 — links this version to the chat message it was saved after (revert mapping).
      messageId: typeof body.messageId === 'string' && body.messageId.length <= 128 ? body.messageId : undefined,
    });

    return json({ ok: true, version });
  } catch (error) {
    console.error('Error saving codebase version:', error);
    return json({ error: 'Failed to save version' }, { status: 500 });
  }
}
