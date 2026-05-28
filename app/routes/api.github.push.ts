import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getCompanyBySlug, getCompanyMember, updateAppStatus, addAuditLog } from '~/lib/database';
import { createAppRepo, pushGeneratedFiles } from '~/lib/github-push';
import type { FileMap } from '~/lib/stores/files';

export async function action({ request, context }: ActionFunctionArgs) {
  const user = await requireAuth(request, context);
  if (!user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    companySlug: string;
    projectId: string;
    appSlug: string;
    files: FileMap;
    githubToken: string;
    deployUrl?: string;
  };

  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { companySlug, projectId, appSlug, files, githubToken, deployUrl } = body;

  if (!companySlug || !projectId || !appSlug || !files || !githubToken) {
    return json({ error: 'Missing required fields' }, { status: 400 });
  }

  const company = await getCompanyBySlug(companySlug);
  if (!company) {
    return json({ error: 'Company not found' }, { status: 404 });
  }

  const member = await getCompanyMember(company.id, user.id);
  if (!member || member.role === 'viewer') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const githubOrg = company.github_org;
  if (!githubOrg) {
    return json({ error: 'Company has no GitHub org configured' }, { status: 400 });
  }

  try {
    const repoUrl = await createAppRepo(githubOrg, appSlug, githubToken);
    const { pushed, failed } = await pushGeneratedFiles(githubOrg, appSlug, files, githubToken);

    await updateAppStatus(projectId, 'active', {
      github_repo: repoUrl,
      ...(deployUrl ? { deploy_url: deployUrl } : {}),
    });

    await addAuditLog({
      companyId: company.id,
      actorId: user.id,
      projectId,
      action: 'PUSH_CODE',
      payload: { repo_url: repoUrl, files_pushed: pushed, files_failed: failed.length },
      ipAddress: request.headers.get('x-forwarded-for'),
    });

    return json({ success: true, repoUrl, pushed, failed });
  } catch (error) {
    console.error('GitHub push error:', error);
    return json({ error: String(error) }, { status: 500 });
  }
}
