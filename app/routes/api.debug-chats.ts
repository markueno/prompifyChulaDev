import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getActiveCompanyId } from '~/lib/workspace.server';
import { getPostgresPool } from '~/lib/database-postgresql';
import { getChatsByUser } from '~/lib/database';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireAuth(request, context);
  const companyId = await getActiveCompanyId(request, user);
  const pool = getPostgresPool();
  const client = await pool.connect();

  const result: Record<string, any> = { userId: user.id, activeCompanyId: companyId };

  try {
    // Test 1: simple query — just chats by user_id
    try {
      const r1 = await client.query(
        `SELECT c.id, c.url_id, c.description, c.updated_at
         FROM chats c
         WHERE c.user_id = $1
         ORDER BY c.updated_at DESC
         LIMIT 20`,
        [user.id]
      );
      result.test1_simple = { count: r1.rowCount, rows: r1.rows };
    } catch (e) {
      result.test1_simple = { error: String(e) };
    }

    // Test 2: check if chat_members table exists
    try {
      const r2 = await client.query(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_members') as exists`
      );
      result.test2_chat_members_exists = r2.rows[0]?.exists;
    } catch (e) {
      result.test2_chat_members_exists = { error: String(e) };
    }

    // Test 3: check if project_members table exists
    try {
      const r3 = await client.query(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'project_members') as exists`
      );
      result.test3_project_members_exists = r3.rows[0]?.exists;
    } catch (e) {
      result.test3_project_members_exists = { error: String(e) };
    }

    // Test 4: exact query from getChatsByUserPostgres
    try {
      const r4 = await client.query(
        `SELECT DISTINCT c.id, c.project_id, c.url_id, c.description, c.messages, c.metadata, c.created_at, c.updated_at, c.last_activity, c.is_archived
         FROM chats c
         LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $1
         LEFT JOIN projects p ON p.id = c.project_id
         LEFT JOIN project_members pm ON pm.project_id = c.project_id AND pm.user_id = $1
         WHERE c.user_id = $1 OR cm.user_id = $1 OR p.owner_user_id = $1 OR pm.user_id = $1
         ORDER BY c.updated_at DESC`,
        [user.id]
      );
      result.test4_exact_query = {
        count: r4.rowCount,
        rows: r4.rows.map((r: any) => ({ id: r.id, url_id: r.url_id, description: r.description })),
      };
    } catch (e) {
      result.test4_exact_query = { error: String(e) };
    }

    // Test 5: call the actual getChatsByUser wrapper (includes JSON parsing)
    try {
      const r5 = await getChatsByUser(user.id, false, companyId);
      result.test5_getChatsByUser = {
        count: r5.length,
        firstChat: r5[0] ? { id: r5[0].id, url_id: r5[0].url_id, description: r5[0].description } : null,
      };
    } catch (e) {
      result.test5_getChatsByUser = { error: String(e), stack: (e as Error)?.stack };
    }

    return json(result);
  } finally {
    client.release();
  }
}
