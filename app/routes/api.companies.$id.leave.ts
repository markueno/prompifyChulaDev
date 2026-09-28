/**
 * DELETE /api/companies/:id/leave — remove yourself from a workspace.
 *
 * Separate from the members route on purpose: that one is for an owner or admin acting on someone
 * else and is gated accordingly, whereas this is a member acting on themselves and needs no
 * management rights at all.
 */
import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { addAuditLog, getCompanyMember, removeCompanyMember } from '~/lib/database';
import { isWorkspaceOwner } from '~/lib/workspace-roles';

export async function action({ request, context, params }: ActionFunctionArgs) {
  if (request.method.toUpperCase() !== 'DELETE') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const user = await requireAuth(request, context);
  const companyId = params.id!;
  const member = await getCompanyMember(companyId, user.id);

  if (!member) {
    return json({ error: 'You are not a member of this workspace' }, { status: 404 });
  }

  /*
   * The owner has nowhere to hand the workspace to — a workspace has exactly one, and ownership
   * transfer does not exist yet. Letting them leave would strand the workspace with no billed
   * identity and nobody who can administer it.
   */
  if (isWorkspaceOwner(member.role)) {
    return json(
      { error: 'The owner cannot leave their own workspace. Delete it instead, or contact support to transfer it.' },
      { status: 400 }
    );
  }

  const success = await removeCompanyMember(companyId, user.id);

  if (success) {
    await addAuditLog({
      companyId,
      actorId: user.id,
      action: 'LEAVE_WORKSPACE',
      payload: { role: member.role },
      ipAddress: request.headers.get('x-forwarded-for'),
    });
  }

  return json({ success });
}
