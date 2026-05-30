import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { saveChat, getChatsByUser, deleteChat, logUserActivity } from '~/lib/database';
import { provisionAppSchema } from '~/lib/supabase-provision.server';

// Get all chats for a user
export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const chats = await getChatsByUser(user.id, user.isModerator);

    // Log activity
    await logUserActivity(user.id, 'chats_loaded', { count: chats.length });

    return json({ chats });
  } catch (error) {
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
        const chatId = await saveChat(user.id, chatData);

        if (chatId) {
          await logUserActivity(user.id, 'chat_saved', { chatId: chatData.id });
          // Fire-and-forget: provision an isolated schema for this app in Supabase.
          // No-op if SUPABASE_URL is not configured.
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

      default:
        return json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error in chat action:', error);
    return json({ error: 'Failed to process chat action' }, { status: 500 });
  }
}
