import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { saveChat, getChatsByUser, deleteChat, renameChat, duplicateChat, logUserActivity } from '~/lib/database';
import { provisionAppSchema } from '~/lib/supabase-provision.server';
import { getActiveCompanyId } from '~/lib/workspace.server';

/**
 * requireAuth throws a *redirect Response* when the session is missing or expired — correct for a
 * page loader, wrong for this endpoint. Catching it as an error and logging it dumped the whole
 * Response object into the container logs on every single call from a tab whose session had been
 * invalidated, and returned a 500 that the client then treated as a transient failure worth
 * retrying. Translate it into a plain 401 the client can recognise and stop on.
 */
function authFailureResponse(error: unknown): Response | null {
  if (error instanceof Response && (error.status === 401 || (error.status >= 300 && error.status < 400))) {
    return json({ error: 'Not authenticated' }, { status: 401 });
  }

  return null;
}

/**
 * GET /api/chats            — the caller's own chats (owned + shared with them).
 * GET /api/chats?scope=all  — every chat on the instance. Moderators only.
 *
 * The scope defaults to "mine" deliberately. `getChatsByUser` drops the ownership filter
 * entirely when its isModerator argument is true, so passing `user.isModerator` through
 * unconditionally would dump every user's history into a moderator's own sidebar.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const wantsAll = new URL(request.url).searchParams.get('scope') === 'all';
    const asModerator = wantsAll && Boolean(user.isModerator);
    const companyId = await getActiveCompanyId(request, user);

    const chats = await getChatsByUser(user.id, asModerator, companyId);

    // Log activity
    await logUserActivity(user.id, 'chats_loaded', { count: chats.length, scope: asModerator ? 'all' : 'mine' });

    return json({ chats });
  } catch (error) {
    const authFailure = authFailureResponse(error);

    if (authFailure) {
      return authFailure;
    }

    console.error('Error loading chats:', error);

    return json({ error: 'Failed to load chats' }, { status: 500 });
  }
}

// Create, update, or delete a chat
export async function action({ request, context }: ActionFunctionArgs) {
  try {
    const user = await requireAuth(request, context);

    // Check if request is JSON or form data
    const contentType = request.headers.get('content-type') || '';
    let chatData: any;
    let action: string;
    let formData: FormData | null = null;

    if (contentType.includes('application/json')) {
      // Handle JSON request (from frontend)
      const body = await request.json();
      chatData = body;
      action = 'save'; // Default action for JSON requests
    } else {
      // Handle form data request
      formData = await request.formData();
      action = formData.get('action') as string;

      chatData = {
        id: formData.get('id') as string,
        urlId: formData.get('urlId') as string,
        projectId: formData.get('projectId') as string,
        description: formData.get('description') as string,
        messages: JSON.parse(formData.get('messages') as string),
        metadata: JSON.parse((formData.get('metadata') as string) || '{}'),
      };
    }

    switch (action) {
      case 'save': {
        const companyId = await getActiveCompanyId(request, user);
        const chatId = await saveChat(user.id, chatData, companyId);

        if (chatId) {
          await logUserActivity(user.id, 'chat_saved', { chatId: chatData.id });

          /*
           * Fire-and-forget: provision an isolated schema for this app in Supabase.
           * No-op if SUPABASE_URL is not configured.
           */
          const cfEnv = (context?.cloudflare?.env as unknown as Record<string, unknown>) ?? {};
          provisionAppSchema(chatData.id || chatId, cfEnv).catch(() => {});

          return json({ success: true, chatId });
        } else {
          return json({ error: 'Failed to save chat' }, { status: 500 });
        }
      }

      case 'delete': {
        const chatId = (formData?.get('chatId') as string) || '';

        if (!chatId) {
          return json({ error: 'Chat ID is required' }, { status: 400 });
        }

        const success = await deleteChat(chatId, user.id);

        if (success) {
          await logUserActivity(user.id, 'chat_deleted', { chatId });
          return json({ success: true });
        } else {
          return json({ error: 'Failed to delete chat' }, { status: 500 });
        }
      }

      /*
       * Rename and duplicate exist here because the project list is served from Postgres. Both
       * actions used to be written to IndexedDB only, which meant they appeared to work and then
       * silently reverted on the next load — and never reached the user's other devices at all.
       */
      case 'rename': {
        const chatId = (formData?.get('chatId') as string) || '';
        const description = ((formData?.get('description') as string) || '').trim();

        if (!chatId || !description) {
          return json({ error: 'Chat ID and description are required' }, { status: 400 });
        }

        if (description.length > 100) {
          return json({ error: 'Description must be 100 characters or fewer' }, { status: 400 });
        }

        const success = await renameChat(chatId, user.id, description);

        if (success) {
          await logUserActivity(user.id, 'chat_renamed', { chatId });
          return json({ success: true });
        }

        // The update matches on user_id, so a miss means it is not this user's chat to rename.
        return json({ error: 'Chat not found' }, { status: 404 });
      }

      case 'duplicate': {
        const chatId = (formData?.get('chatId') as string) || '';

        if (!chatId) {
          return json({ error: 'Chat ID is required' }, { status: 400 });
        }

        const result = await duplicateChat(chatId, user.id);

        if (result.ok) {
          await logUserActivity(user.id, 'chat_duplicated', { chatId, urlId: result.urlId });
          return json({ success: true, urlId: result.urlId });
        }

        // 404 only when the chat genuinely is not this user's; a failed copy is a 500, not a lie.
        return result.reason === 'not_found'
          ? json({ error: 'Chat not found' }, { status: 404 })
          : json({ error: 'Could not duplicate this project' }, { status: 500 });
      }

      default:
        return json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    const authFailure = authFailureResponse(error);

    if (authFailure) {
      return authFailure;
    }

    console.error('Error in chat action:', error);

    return json({ error: 'Failed to process chat action' }, { status: 500 });
  }
}
