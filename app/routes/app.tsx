import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Outlet } from '@remix-run/react';
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getSubscriptionByUserId } from '~/lib/database';

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (isAuthDisabled(context)) {
    const mockUser = getMockAdminUser();
    return json({ user: mockUser });
  }

  const user = await requireAuth(request, context);
  const sub = await getSubscriptionByUserId(user.id);
  const userWithTier = { ...user, accountTier: sub?.tier_display_name ?? null };

  return json({ user: userWithTier });
}

export default function AppLayout() {
  return <Outlet />;
}
