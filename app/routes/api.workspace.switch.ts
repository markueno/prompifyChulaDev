import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { optionalAuth } from '~/lib/auth';
import { getCompanyMember } from '~/lib/database';
import { personalCompanyId } from '~/lib/database-postgresql';
import { activeWorkspaceCookie } from '~/lib/workspace.server';

/** POST { companyId } → sets the active_workspace cookie after verifying membership. */
export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const user = await optionalAuth(request, context);

  if (!user?.id) {
    return json({ error: 'Not signed in' }, { status: 401 });
  }

  let companyId = '';

  try {
    const body = (await request.json()) as { companyId?: string };
    companyId = body.companyId ?? '';
  } catch {
    return json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!companyId) {
    return json({ error: 'companyId required' }, { status: 400 });
  }

  // The personal workspace is always the user's own; team workspaces require membership.
  if (companyId !== personalCompanyId(user.id)) {
    const member = await getCompanyMember(companyId, user.id);

    if (!member) {
      return json({ error: 'Not a member of this workspace' }, { status: 403 });
    }
  }

  return json({ ok: true }, { headers: { 'Set-Cookie': activeWorkspaceCookie(companyId) } });
}
