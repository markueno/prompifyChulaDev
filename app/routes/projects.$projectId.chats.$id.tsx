import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import AppIndexRoute, { links, meta } from './app._index';
import { redirect } from '@remix-run/cloudflare';

export { links, meta };
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getChatById, getSubscriptionByUserId } from '~/lib/database';

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  if (!params.id || !params.projectId) {
    throw redirect('/app/');
  }

  // Check if authentication is disabled first
  if (isAuthDisabled(context)) {
    const mockUser = getMockAdminUser();
    const chat = await getChatById(params.id, mockUser.id, true, params.projectId);

    if (!chat) {
      throw redirect('/app/');
    }

    return json({ id: params.id, projectId: params.projectId, user: mockUser });
  }

  // Only check authentication if it's enabled
  const user = await requireAuth(request, context);
  const chat = await getChatById(params.id, user.id, user.isModerator, params.projectId);

  if (!chat) {
    throw redirect('/app/');
  }

  const sub = await getSubscriptionByUserId(user.id);
  const userWithTier = { ...user, accountTier: sub?.tier_display_name ?? null };

  return json({ id: params.id, projectId: params.projectId, user: userWithTier });
}

export default AppIndexRoute;
