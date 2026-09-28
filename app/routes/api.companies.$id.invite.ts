/**
 * Email invitations to a workspace. Owner-only.
 *
 * GET    — list pending invitations
 * POST   — invite { email, role }
 * DELETE — revoke { invitationId }
 *
 * Distinct from api.companies.$id.invite-code.ts, which mints a shareable code anyone can redeem.
 * This names one address and only that person can accept it.
 */
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import {
  addAuditLog,
  getUserCompanies,
  getCompanyMember,
  inviteToCompany,
  listCompanyInvitations,
  revokeCompanyInvitation,
} from '~/lib/database';
import type { CompanyRole } from '~/lib/database';
import { sendWorkspaceInvitationEmail } from '~/lib/email';
import { isWorkspaceOwner } from '~/lib/workspace-roles';

const INVITABLE_ROLES: CompanyRole[] = ['owner', 'developer', 'viewer'];

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const user = await requireAuth(request, context);
  const companyId = params.id!;
  const member = await getCompanyMember(companyId, user.id);

  if (!isWorkspaceOwner(member?.role)) {
    return json({ error: 'Only the workspace owner can view invitations' }, { status: 403 });
  }

  return json({ invitations: await listCompanyInvitations(companyId) });
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const user = await requireAuth(request, context);
  const companyId = params.id!;
  const member = await getCompanyMember(companyId, user.id);

  if (!isWorkspaceOwner(member?.role)) {
    return json({ error: 'Only the workspace owner can manage invitations' }, { status: 403 });
  }

  const method = request.method.toUpperCase();

  if (method === 'POST') {
    const { email, role } = (await request.json()) as { email?: string; role?: CompanyRole };
    const trimmed = (email ?? '').trim();

    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return json({ error: 'Enter a valid email address' }, { status: 400 });
    }

    const chosenRole: CompanyRole = INVITABLE_ROLES.includes(role as CompanyRole) ? (role as CompanyRole) : 'developer';

    const result = await inviteToCompany({
      companyId,
      email: trimmed,
      invitedByUserId: user.id,
      role: chosenRole,
    });

    if (!result.success || !result.token) {
      return json({ error: result.error ?? 'Could not create the invitation' }, { status: 409 });
    }

    const company = (await getUserCompanies(user.id)).find((c: any) => c.id === companyId);
    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    const acceptUrl = `${appUrl}/invite/accept?token=${result.token}&kind=workspace`;

    /*
     * A failed send is not a failed invitation — the row exists and the link works, so the owner
     * can copy it manually. Same posture as the project invite flow.
     */
    const emailed = await sendWorkspaceInvitationEmail(trimmed, user.email, company?.name ?? 'a workspace', acceptUrl);

    await addAuditLog({
      companyId,
      actorId: user.id,
      action: 'MEMBER_INVITE',
      payload: { email: trimmed, role: chosenRole, emailed },
      ipAddress: request.headers.get('x-forwarded-for'),
    });

    return json({ success: true, emailed });
  }

  if (method === 'DELETE') {
    const { invitationId } = (await request.json()) as { invitationId?: string };

    if (!invitationId) {
      return json({ error: 'invitationId is required' }, { status: 400 });
    }

    return json({ success: await revokeCompanyInvitation(companyId, invitationId) });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
}
