import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import AppIndexRoute, { links, meta } from './app._index';
import { redirect } from '@remix-run/cloudflare';

export { links, meta };
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getSubscriptionByCompanyId } from '~/lib/database';
import { getActiveCompanyId } from '~/lib/workspace.server';

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  if (!params.id || !params.projectId) {
    throw redirect('/app/');
  }

  /*
   * Do NOT gate on the chat existing in Postgres here. Chats are dual-written (IndexedDB +
   * Postgres) and IndexedDB is the source of truth for instant/offline loads (ARCHITECTURE-v2).
   * A chat can legitimately exist only in IndexedDB — imported, or created while the server was
   * unreachable — and the server can't see IndexedDB, so a Postgres-miss here used to wrongly
   * redirect such chats to /app/. The client loadChat() resolves the chat from IndexedDB ->
   * /api/chat/:id -> redirect home if truly absent, and /api/chat/:id enforces ownership. So this
   * loader only authenticates and hands the ids to the app shell (which carries no chat data).
   */
  if (isAuthDisabled(context)) {
    return json({ id: params.id, projectId: params.projectId, user: getMockAdminUser() });
  }

  const user = await requireAuth(request, context);
  const companyId = await getActiveCompanyId(request, user);
  const sub = await getSubscriptionByCompanyId(companyId);
  const userWithTier = { ...user, accountTier: sub?.tier_display_name ?? null };

  return json({ id: params.id, projectId: params.projectId, user: userWithTier });
}

export default AppIndexRoute;
