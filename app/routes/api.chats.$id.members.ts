import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getChatMembers, updateChatMemberRole, removeChatMember } from '~/lib/database';

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const chatId = params.id;
    if (!chatId) return json({ error: 'Chat ID required' }, { status: 400 });

    const result = await getChatMembers(chatId, user.id, user.isModerator);
    return json(result);
  } catch (error) {
    console.error('Error loading chat members:', error);
    return json({ error: 'Failed to load members' }, { status: 500 });
  }
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const chatId = params.id;
    if (!chatId) return json({ success: false, error: 'Chat ID required' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const { action: actionType, targetUserId, role } = body;

    if (actionType === 'updateRole' && targetUserId && role) {
      const result = await updateChatMemberRole(chatId, user.id, targetUserId, role, user.isModerator);
      if (!result.success) return json({ success: false, error: result.error }, { status: 400 });
      return json({ success: true });
    }

    if (actionType === 'remove' && targetUserId) {
      const result = await removeChatMember(chatId, user.id, targetUserId, user.isModerator);
      if (!result.success) return json({ success: false, error: result.error }, { status: 400 });
      return json({ success: true });
    }

    return json({ success: false, error: 'Invalid request' }, { status: 400 });
  } catch (error) {
    console.error('Error in members action:', error);
    return json({ success: false, error: 'Failed to process request' }, { status: 500 });
  }
}
