import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getChatById, logUserActivity } from '~/lib/database';
import { DEFAULT_PROJECT_ID } from '~/utils/chatRoutes';

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

    // 'personal' (DEFAULT_PROJECT_ID) is a synthetic URL slug, not a real project id — personal
    // chats live under proj_personal_<userId>. Don't filter by it or the lookup never matches.
    const effectiveProjectId = projectId === DEFAULT_PROJECT_ID ? undefined : projectId;
    const chat = await getChatById(chatId, user.id, user.isModerator, effectiveProjectId);

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
