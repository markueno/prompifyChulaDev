import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getChatInvitations } from '~/lib/database';

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const chatId = params.id;

    if (!chatId) {
      return json({ error: 'Chat ID required' }, { status: 400 });
    }

    const invitations = await getChatInvitations(chatId, user.id);

    return json({ invitations });
  } catch (error) {
    console.error('Error loading chat invitations:', error);
    return json({ error: 'Failed to load invitations' }, { status: 500 });
  }
}
