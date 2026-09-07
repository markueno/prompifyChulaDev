import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Outlet, useLoaderData } from '@remix-run/react';
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getSubscriptionByCompanyId, getUserStatus } from '~/lib/database';
import { getActiveCompanyId } from '~/lib/workspace.server';
import { parseAccountStatus } from '~/lib/account-status';
import { AccountStatusDialog } from '~/components/auth/AccountStatusDialog';

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (isAuthDisabled(context)) {
    const mockUser = getMockAdminUser();
    return json({ user: mockUser, accountStatus: 'active' as const });
  }

  const user = await requireAuth(request, context);
  const companyId = await getActiveCompanyId(request, user);

  const [sub, status] = await Promise.all([getSubscriptionByCompanyId(companyId), getUserStatus(user.id)]);
  const userWithTier = { ...user, accountTier: sub?.tier_display_name ?? null };

  /*
   * Read here rather than from the JWT so an admin's change is reflected on the next page load,
   * and surfaced from the layout so every /app/* route shows the notice without each one
   * remembering to.
   */
  return json({ user: userWithTier, accountStatus: parseAccountStatus(status) });
}

export default function AppLayout() {
  const { accountStatus } = useLoaderData<typeof loader>();

  return (
    <>
      <Outlet />
      <AccountStatusDialog status={accountStatus} />
    </>
  );
}
