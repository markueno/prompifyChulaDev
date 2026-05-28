import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import {
  getCompanyMember,
  getCompanyMembers,
  addCompanyMember,
  removeCompanyMember,
  addAuditLog,
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
    if (!requester || requester.role !== 'admin') {
      return json({ error: 'Only company admins can manage members' }, { status: 403 });
    }

    if (method === 'POST') {
      const { userId, role } = (await request.json()) as { userId: string; role: CompanyRole };
      if (!userId || !role) {
        return json({ error: 'userId and role are required' }, { status: 400 });
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
