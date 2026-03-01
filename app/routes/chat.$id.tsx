import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { default as IndexRoute } from './_index';
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getSubscriptionByUserId } from '~/lib/database';

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  // Check if authentication is disabled first
  if (isAuthDisabled(context)) {
    const mockUser = getMockAdminUser();
    return json({ id: params.id, user: mockUser });
  }

  // Only check authentication if it's enabled
  const user = await requireAuth(request, context);
  const sub = await getSubscriptionByUserId(user.id);
  const userWithTier = { ...user, accountTier: sub?.tier_display_name ?? null };
  return json({ id: params.id, user: userWithTier });
}

export default IndexRoute;
