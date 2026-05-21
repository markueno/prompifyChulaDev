import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getChatById, logUserActivity } from '~/lib/database';

// Get a specific chat by ID
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const chatId = params.id;
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId') || undefined;

    if (!chatId) {
      return json({ error: 'Chat ID is required' }, { status: 400 });
    }

    const chat = await getChatById(chatId, user.id, user.isModerator, projectId);

    if (!chat) {
      return json({ error: 'Chat not found' }, { status: 404 });
    }

    // Log activity
    await logUserActivity(user.id, 'chat_accessed', { chatId, projectId: projectId ?? null });

    return json({ chat });
  } catch (error) {
    console.error('Error loading chat:', error);
    return json({ error: 'Failed to load chat' }, { status: 500 });
  }
}
