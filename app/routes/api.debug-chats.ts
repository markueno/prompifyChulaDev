import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getActiveCompanyId } from '~/lib/workspace.server';
import { getPostgresPool } from '~/lib/database-postgresql';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireAuth(request, context);
  const companyId = await getActiveCompanyId(request, user);
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const directResult = await client.query(
      `SELECT c.id, c.user_id, c.project_id, c.url_id, c.description, c.created_at, c.updated_at
       FROM chats c
       WHERE c.user_id = $1
       ORDER BY c.updated_at DESC
       LIMIT 20`,
      [user.id]
    );

    const joinResult = await client.query(
      `SELECT DISTINCT c.id, c.url_id, c.description
       FROM chats c
       LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $1
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN project_members pm ON pm.project_id = c.project_id AND pm.user_id = $1
       WHERE c.user_id = $1 OR cm.user_id = $1 OR p.owner_user_id = $1 OR pm.user_id = $1
       ORDER BY c.updated_at DESC
       LIMIT 20`,
      [user.id]
    );

    return json({
      userId: user.id,
      activeCompanyId: companyId,
      directCount: directResult.rowCount,
      joinCount: joinResult.rowCount,
      directChats: directResult.rows,
      joinChats: joinResult.rows,
    });
  } catch (error) {
    return json({ error: String(error), stack: (error as Error)?.stack }, { status: 500 });
  } finally {
    client.release();
  }
}
