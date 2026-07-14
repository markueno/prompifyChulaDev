/**
 * POST /api/data/token  — issue a short-lived data API token for a chat.
 *
 * Validates the session JWT first, verifies the caller owns (or is a member of)
 * the chat, then returns a 15-minute data token scoped to (userId, chatId).
 * Deployed apps use this bearer token for cross-origin data-proxy calls.
 */
import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getChatById } from '~/lib/database';
import { issueDataApiToken } from '~/lib/.server/data-token';

export async function action({ request, context }: ActionFunctionArgs) {
  const user = await requireAuth(request, context);

  try {
    const body = (await request.json()) as { chatId?: string };
    const chatId = body?.chatId;

    if (!chatId) {
      return json({ error: 'chatId is required' }, { status: 400 });
    }

    // Ownership / access check — same gate as the data proxy.
    const chat = await getChatById(chatId, user.id, user.isModerator);

    if (!chat) {
      return json({ error: 'Not found' }, { status: 404 });
    }

    // v1 strict schema-per-user: only the owner (or moderator) gets a data
    // token. Non-owner chat members get 403 (no sharing in v1).
    if (chat.user_id !== user.id && !user.isModerator) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    const env = (context?.cloudflare?.env as unknown as Record<string, unknown>) ?? {};
    const token = issueDataApiToken(user.id, chat.id, env);

    return json({
      token,
      chatId: chat.id,
      expiresIn: 900,
    });
  } catch (error) {
    console.error('[api.data.token] error:', error);
    return json({ error: 'Failed to issue token' }, { status: 500 });
  }
}
