import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getPromptsByChatId } from '~/lib/database';

/** GET /api/chats/:id/prompts - List prompts for a chat (account + message_id per prompt) */
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const chatId = params.id;

    if (!chatId) {
      return json({ error: 'Chat ID required' }, { status: 400 });
    }

    const prompts = await getPromptsByChatId(chatId, user.id, user.isModerator);

    return json({ prompts });
  } catch (error) {
    console.error('Error loading prompts:', error);
    return json({ error: 'Failed to load prompts' }, { status: 500 });
  }
}
