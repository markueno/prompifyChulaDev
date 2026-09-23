import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import {
  getCompanyMember,
  createCompanyInviteCode,
  listCompanyInviteCodes,
  deactivateCompanyInviteCode,
} from '~/lib/database';

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const user = await requireAuth(request, context);
  const companyId = params.id;

  if (!companyId) {
    return json({ error: 'Company ID is required' }, { status: 400 });
  }

  const member = await getCompanyMember(companyId, user.id);

  if (!member || member.role !== 'admin') {
    return json({ error: 'Only workspace admins can view invite codes' }, { status: 403 });
  }

  const codes = await listCompanyInviteCodes(companyId);

  return json({ codes });
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const user = await requireAuth(request, context);
  const companyId = params.id;

  if (!companyId) {
    return json({ error: 'Company ID is required' }, { status: 400 });
  }

  const member = await getCompanyMember(companyId, user.id);

  if (!member || member.role !== 'admin') {
    return json({ error: 'Only workspace admins can manage invite codes' }, { status: 403 });
  }

  const method = request.method;

  if (method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { maxUses?: number; expiresInDays?: number };
    const maxUses = typeof body.maxUses === 'number' ? body.maxUses : undefined;
    const expiresInDays = typeof body.expiresInDays === 'number' ? body.expiresInDays : undefined;

    const code = await createCompanyInviteCode(companyId, user.id, maxUses, expiresInDays);

    if (!code) {
      return json({ error: 'Failed to create invite code' }, { status: 500 });
    }

    return json({ code }, { status: 201 });
  }

  if (method === 'DELETE') {
    const body = (await request.json().catch(() => ({}))) as { codeId?: string };
    const codeId = body.codeId;

    if (!codeId || typeof codeId !== 'string') {
      return json({ error: 'codeId is required' }, { status: 400 });
    }

    const ok = await deactivateCompanyInviteCode(codeId, companyId);

    if (!ok) {
      return json({ error: 'Invite code not found' }, { status: 404 });
    }

    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
}
