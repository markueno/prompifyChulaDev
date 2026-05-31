import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { inviteToChat, getChatById } from '~/lib/database';
import { sendInvitationEmail } from '~/lib/email';

export async function action({ request, context, params }: ActionFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const chatId = params.id;

    if (!chatId) {
      return json({ success: false, error: 'Chat ID required' }, { status: 400 });
    }

    if (request.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed' }, { status: 405 });
    }

    const body = (await request.json().catch(() => ({}))) as any;
    const email = body?.email?.trim();

    if (!email) {
      return json({ success: false, error: 'Email is required' }, { status: 400 });
    }

    const result = await inviteToChat(chatId, user.id, email, body?.role || 'member');

    if (!result.success) {
      return json({ success: false, error: result.error }, { status: 400 });
    }

    if (result.alreadyMember) {
      return json({ success: true, alreadyMember: true, message: 'This person already has access to the project.' });
    }

    const baseUrl = process.env.APP_URL || 'http://localhost:5173';
    const acceptUrl = `${baseUrl}/invite/accept?token=${result.token}`;

    const chat = await getChatById(chatId, user.id, user.isModerator);
    const projectName = chat?.description || 'Untitled project';

    const emailSent = await sendInvitationEmail(email, user.email, projectName, acceptUrl);

    if (!emailSent) {
      console.warn('[Invite] Email could not be sent to', email, '- invite link created, inviter can share manually');
    }

    return json({ success: true, token: result.token });
  } catch (error) {
    console.error('Error inviting to chat:', error);
    return json({ success: false, error: 'Failed to send invitation' }, { status: 500 });
  }
}
