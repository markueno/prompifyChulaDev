import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import AppIndexRoute, { links, meta } from './app._index';
import { redirect } from '@remix-run/cloudflare';

export { links, meta };
import { requireAuth, isAuthDisabled, getMockAdminUser } from '~/lib/auth';
import { getCompanyMember, getEffectiveProjectRole, getSubscriptionByCompanyId } from '~/lib/database';
import { canBuildInProject, canSeeProjectInternals } from '~/lib/project-roles';
import { personalCompanyId } from '~/lib/database-postgresql';
import { canBuildInWorkspace } from '~/lib/workspace-roles';
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
    return json({
      id: params.id,
      projectId: params.projectId,
      user: getMockAdminUser(),
      canBuild: true,
      viewOnlyReason: null,
    });
  }

  const user = await requireAuth(request, context);
  const companyId = await getActiveCompanyId(request, user);
  const [sub, member, projectRole] = await Promise.all([
    getSubscriptionByCompanyId(companyId),
    getCompanyMember(companyId, user.id),
    getEffectiveProjectRole(params.id, user.id),
  ]);
  const userWithTier = { ...user, accountTier: sub?.tier_display_name ?? null };

  /*
   * Exactly the rule /api/chat applies, deliberately duplicated rather than approximated — a
   * composer that appears and is then refused is worse than no composer.
   *
   * For an existing project the effective role decides on its own: it already folds in the
   * workspace role and returns the stronger of the two. Combining it with a separate workspace
   * test, as this used to, got two cases wrong — a guest shared one project was shown a composer
   * the server refused, and someone whose ACTIVE workspace happened to be one they only view had
   * the composer hidden on a project they were entitled to build in.
   *
   * A chat that does not exist yet is about to be created by this very request, so there is no
   * project role to consult and the workspace decides.
   */
  const canBuildHere = projectRole.exists
    ? canBuildInProject(projectRole.role)
    : companyId === personalCompanyId(user.id) || canBuildInWorkspace(member?.role);

  /*
   * Which permission is the reason, so the notice says something true. 'project' whenever the
   * project itself is what refuses — that is the specific and actionable answer.
   */
  const viewOnlyReason = canBuildHere ? null : projectRole.exists ? 'project' : 'workspace';

  return json({
    id: params.id,
    projectId: params.projectId,
    user: userWithTier,
    canBuild: canBuildHere,
    viewOnlyReason,
    previewOnly: projectRole.exists && !canSeeProjectInternals(projectRole.role),
  });
}

export default AppIndexRoute;
