import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { canManageMembers, isAssignableRole, isWorkspaceOwner } from '~/lib/workspace-roles';
import {
  getCompanyMember,
  getCompanyMembers,
  addCompanyMember,
  removeCompanyMember,
  addAuditLog,
  getCompanySeats,
  getCompanyMemberCount,
} from '~/lib/database';
import type { CompanyRole } from '~/lib/database';

export async function loader({ request, context, params }: ActionFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const companyId = params.id!;

    const member = await getCompanyMember(companyId, user.id);

    if (!member) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    const members = await getCompanyMembers(companyId);

    return json({ members });
  } catch (error) {
    console.error('Error loading members:', error);
    return json({ error: 'Failed to load members' }, { status: 500 });
  }
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const companyId = params.id!;
    const method = request.method.toUpperCase();

    const requester = await getCompanyMember(companyId, user.id);

    if (!canManageMembers(requester?.role)) {
      return json({ error: 'Only owners and admins can manage members' }, { status: 403 });
    }

    /*
     * The owner is the workspace's single billed identity, so no membership operation may create a
     * second one or remove the existing one. Grants are limited to the assignable roles, and the
     * owner's own row is off limits to everyone — including an admin, who may remove anyone else.
     */
    const isOwnerRow = async (targetUserId: string) =>
      isWorkspaceOwner((await getCompanyMember(companyId, targetUserId))?.role);

    if (method === 'POST') {
      const { userId, role } = (await request.json()) as { userId: string; role: CompanyRole };

      if (!userId || !role) {
        return json({ error: 'userId and role are required' }, { status: 400 });
      }

      if (!isAssignableRole(role)) {
        return json({ error: 'A workspace has exactly one owner, so that role cannot be granted.' }, { status: 400 });
      }

      // Seat guard: only count NEW members against the plan's seat cap.
      const alreadyMember = await getCompanyMember(companyId, userId);

      if (!alreadyMember) {
        const [seats, count] = await Promise.all([getCompanySeats(companyId), getCompanyMemberCount(companyId)]);

        if (count >= seats) {
          return json(
            { error: `Seat limit reached (${seats}). Upgrade the plan to add more members.`, code: 'seat_limit' },
            { status: 402 }
          );
        }
      }

      const success = await addCompanyMember(companyId, userId, role);

      if (success) {
        await addAuditLog({
          companyId,
          actorId: user.id,
          action: 'MEMBER_ADD',
          payload: { target_user_id: userId, role },
          ipAddress: request.headers.get('x-forwarded-for'),
        });
      }

      return json({ success });
    }

    if (method === 'PATCH') {
      const { userId, role } = (await request.json()) as { userId: string; role: CompanyRole };

      if (!userId || !role) {
        return json({ error: 'userId and role are required' }, { status: 400 });
      }

      /*
       * Role changes apply to existing members only. addCompanyMember upserts, so without this
       * check a PATCH naming a non-member would quietly enrol them — past the seat cap the POST
       * branch enforces. Adding someone is POST's job, where that guard lives.
       */
      const target = await getCompanyMember(companyId, userId);

      if (!target) {
        return json({ error: 'That user is not a member of this workspace' }, { status: 404 });
      }

      if (!isAssignableRole(role)) {
        return json({ error: 'A workspace has exactly one owner, so that role cannot be granted.' }, { status: 400 });
      }

      if (isWorkspaceOwner(target.role)) {
        return json({ error: "The owner's role cannot be changed." }, { status: 403 });
      }

      const success = await addCompanyMember(companyId, userId, role);

      if (success) {
        await addAuditLog({
          companyId,
          actorId: user.id,
          action: 'MEMBER_ROLE_CHANGE',
          payload: { target_user_id: userId, new_role: role },
          ipAddress: request.headers.get('x-forwarded-for'),
        });
      }

      return json({ success });
    }

    if (method === 'DELETE') {
      const { userId } = (await request.json()) as { userId: string };

      if (!userId) {
        return json({ error: 'userId is required' }, { status: 400 });
      }

      if (userId === user.id) {
        return json({ error: 'You cannot remove yourself' }, { status: 400 });
      }

      // Removing the owner would leave the workspace with no billed identity and nobody who can pay.
      if (await isOwnerRow(userId)) {
        return json({ error: 'The workspace owner cannot be removed.' }, { status: 403 });
      }

      const success = await removeCompanyMember(companyId, userId);

      if (success) {
        await addAuditLog({
          companyId,
          actorId: user.id,
          action: 'MEMBER_REMOVE',
          payload: { target_user_id: userId },
          ipAddress: request.headers.get('x-forwarded-for'),
        });
      }

      return json({ success });
    }

    return json({ error: 'Method not allowed' }, { status: 405 });
  } catch (error) {
    console.error('Error managing members:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
