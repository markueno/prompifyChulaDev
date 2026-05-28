import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getCompanyMember } from '~/lib/database';
import { wakeApp } from '~/lib/app-lifecycle';

async function getProjectCompany(projectId: string): Promise<{ company_id: string } | null> {
  const { getPostgresPool } = await import('~/lib/database-postgresql');
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT company_id FROM projects WHERE id = $1 LIMIT 1`,
      [projectId]
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  try {
    const user = await requireAuth(request, context);
    const projectId = params.id!;

    const project = await getProjectCompany(projectId);
    if (!project?.company_id) {
      return json({ error: 'App not found' }, { status: 404 });
    }

    const member = await getCompanyMember(project.company_id, user.id);
    if (!member || member.role === 'viewer') {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await wakeApp(
      projectId,
      project.company_id,
      user.id,
      request.headers.get('x-forwarded-for')
    );

    return json(result, { status: result.success ? 200 : 500 });
  } catch (error) {
    console.error('Wake error:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
