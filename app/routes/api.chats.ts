import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { saveChat, getChatsByUser, getChatById, deleteChat, logUserActivity } from '~/lib/database';

// Get all chats for a user
export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const chats = await getChatsByUser(user.id);
    
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
    const formData = await request.formData();
    const action = formData.get('action') as string;
    
    switch (action) {
      case 'save': {
        const chatData = {
          id: formData.get('id') as string,
          urlId: formData.get('urlId') as string,
          description: formData.get('description') as string,
          messages: JSON.parse(formData.get('messages') as string),
          metadata: JSON.parse(formData.get('metadata') as string || '{}')
        };
        
        const chatId = await saveChat(user.id, chatData);
        
        if (chatId) {
          await logUserActivity(user.id, 'chat_saved', { chatId: chatData.id });
          return json({ success: true, chatId });
        } else {
          return json({ error: 'Failed to save chat' }, { status: 500 });
        }
      }
      
      case 'delete': {
        const chatId = formData.get('chatId') as string;
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

