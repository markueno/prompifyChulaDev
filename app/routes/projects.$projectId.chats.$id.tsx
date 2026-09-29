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

  // Same rule as the app shell: a viewer must not be offered a composer that will be refused.
  const canBuildInWorkspaceHere = companyId === personalCompanyId(user.id) ? true : canBuildInWorkspace(member?.role);

  /*
   * Two separate permissions, and both have to pass. Someone can build across the workspace and
   * still be a viewer on one project they were invited to individually, or the other way round.
   *
   * Only consulted when the project actually exists: a chat that is about to be created by its
   * first message has no row and no members yet, and its creator must not be locked out of it.
   */
  const canBuildHere = canBuildInWorkspaceHere && (!projectRole.exists || canBuildInProject(projectRole.role));

  /*
   * Which of the two is the reason, so the notice can say something true rather than something
   * generic. The project is the more specific answer, so it wins when both apply.
   */
  const viewOnlyReason = canBuildHere
    ? null
    : projectRole.exists && !canBuildInProject(projectRole.role)
      ? 'project'
      : 'workspace';

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
