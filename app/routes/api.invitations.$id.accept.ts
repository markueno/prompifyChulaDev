import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { acceptInvitationById } from '~/lib/database';

/**
 * POST /api/invitations/:id/accept — accept a project invitation you are already signed in for.
 *
 * The token-bearing route (`/invite/accept?token=…`) exists for someone arriving from an email
 * before they have an account or a session. Once signed in, a token is the wrong mechanism: the
 * session already proves identity, so there is nothing for a secret to add. This route is what
 * allows invitation tokens to be hashed at rest — the pending-invitations list no longer needs to
 * carry one for the invitee to act on it.
 *
 * Authorization is inside `acceptInvitationById`, which checks the invitation's email against the
 * caller's own in the same transaction that consumes it. The id is therefore not a credential:
 * knowing someone else's invitation id gains nothing.
 */
export async function action({ request, context, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, { status: 405 });
  }

  const invitationId = params.id;

  if (!invitationId) {
    return json({ success: false, error: 'Invitation id required' }, { status: 400 });
  }

  try {
    const user = await requireAuth(request, context);
    const result = await acceptInvitationById(invitationId, user.id, user.email);

    if (!result.success) {
      return json({ success: false, error: result.error }, { status: 400 });
    }

    return json({ success: true, chatUrl: result.chatUrl });
  } catch (error) {
    /*
     * requireAuth throws a redirect Response, which is right for a page loader and wrong here —
     * return it so the client sees a 302/401 rather than this becoming a 500.
     */
    if (error instanceof Response) {
      return error;
    }

    console.error('Error accepting invitation by id:', error);

    return json({ success: false, error: 'Failed to accept invitation' }, { status: 500 });
  }
}
