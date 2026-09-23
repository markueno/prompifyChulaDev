import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { joinCompanyByCode } from '~/lib/database';
import { activeWorkspaceCookie } from '~/lib/workspace.server';

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const user = await requireAuth(request, context);

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = typeof body.code === 'string' ? body.code.trim() : '';

  if (!code) {
    return json({ error: 'Invite code is required' }, { status: 400 });
  }

  const result = await joinCompanyByCode(code, user.id);

  if (!result) {
    return json({ error: 'Invalid, expired, or exhausted invite code' }, { status: 404 });
  }

  return json(
    { ok: true, company: result.company, alreadyMember: result.alreadyMember },
    { headers: { 'Set-Cookie': activeWorkspaceCookie(result.company.id) } }
  );
}
