import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getPendingInvitationsForUser } from '~/lib/database';

export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const invitations = await getPendingInvitationsForUser(user.email);
    return json({ invitations });
  } catch {
    return json({ invitations: [] });
  }
}
