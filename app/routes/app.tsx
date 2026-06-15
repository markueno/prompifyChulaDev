import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Outlet } from '@remix-run/react';
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getSubscriptionByCompanyId } from '~/lib/database';
import { getActiveCompanyId } from '~/lib/workspace.server';

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (isAuthDisabled(context)) {
    const mockUser = getMockAdminUser();
    return json({ user: mockUser });
  }

  const user = await requireAuth(request, context);
  const companyId = await getActiveCompanyId(request, user);
  const sub = await getSubscriptionByCompanyId(companyId);
  const userWithTier = { ...user, accountTier: sub?.tier_display_name ?? null };

  return json({ user: userWithTier });
}

export default function AppLayout() {
  return <Outlet />;
}
