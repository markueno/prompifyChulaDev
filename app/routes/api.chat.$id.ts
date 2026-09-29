import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getChatById, getEffectiveProjectRole, logUserActivity } from '~/lib/database';
import { canSeeProjectInternals } from '~/lib/project-roles';
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

    /*
     * 'personal' (DEFAULT_PROJECT_ID) is a synthetic URL slug, not a real project id — personal
     * chats live under proj_personal_<userId>. Don't filter by it or the lookup never matches.
     */
    const effectiveProjectId = projectId === DEFAULT_PROJECT_ID ? undefined : projectId;
    const chat = await getChatById(chatId, user.id, user.isModerator, effectiveProjectId);

    if (!chat) {
      return json({ error: 'Chat not found' }, { status: 404 });
    }

    // Log activity
    await logUserActivity(user.id, 'chat_accessed', { chatId, projectId: projectId ?? null });

    /*
     * A viewer gets the project without its conversation.
     *
     * This is the one place the restriction can actually be made real. The messages are where
     * someone typed what the business needs, and withholding them here means they never reach the
     * browser at all — not hidden by the interface, simply not sent.
     *
     * The generated CODE is a different matter and is NOT protected by this. The preview runs in
     * the viewer's own browser via WebContainer, so the files have to be shipped there for
     * anything to render; they come from the snapshot endpoint instead of from here. Hiding the
     * editor is a courtesy, not a boundary, and anyone determined can read them from devtools.
     * Genuinely withholding code would mean serving a deployed build rather than running it
     * locally, which is a different feature.
     */
    const { role } = await getEffectiveProjectRole(chatId, user.id);

    if (!canSeeProjectInternals(role)) {
      return json({ chat: { ...chat, messages: [] }, previewOnly: true, role });
    }

    return json({ chat, previewOnly: false, role });
  } catch (error) {
    console.error('Error loading chat:', error);
    return json({ error: 'Failed to load chat' }, { status: 500 });
  }
}
