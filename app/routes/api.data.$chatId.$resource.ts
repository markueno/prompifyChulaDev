/**
 * Remix data proxy for generated apps (ARCHITECTURE-v2.md Part 2).
 *
 *   GET    /api/data/:chatId/:resource?select=col1,col2&limit=100   -> rows
 *   POST   /api/data/:chatId/:resource          body=object         -> created row
 *   PATCH  /api/data/:chatId/:resource?id=...   body=partial        -> updated row
 *   DELETE /api/data/:chatId/:resource?id=...                       -> { deleted: true }
 *
 * Auth: a bearer data API token (cross-origin, deployed apps) OR the session
 * cookie (same-origin, in-IDE preview). The schema is derived SERVER-SIDE from
 * the chat owner — the client NEVER sends a schema selector.
 *
 * Isolation (strict schema-per-user, no sharing): only the chat OWNER (or a
 * moderator) may access. Chat members who are not the owner get 403 — v1 has
 * no cross-user sharing. The table must be registered to THIS chat via the
 * app_tables registry, otherwise 404 (app A cannot read app B's tables).
 */
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth, type User } from '~/lib/auth';
import { getChatById } from '~/lib/database';
import { getPostgresPool } from '~/lib/database-postgresql';
import {
  getRegisteredTable,
  runAppQuery,
  type AppTableMeta,
} from '~/lib/data-provision.server';
import { validateDataApiToken } from '~/lib/.server/data-token';

const MAX_ROWS = 1000;
const VALID_COLUMN = /^[a-z][a-z0-9_]{0,62}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ResolvedContext {
  user: User;
  ownerId: string;
  table: AppTableMeta;
}

function getCtxEnv(context: ActionFunctionArgs['context']): Record<string, unknown> {
  return (context?.cloudflare?.env as unknown as Record<string, unknown>) ?? {};
}

/**
 * Resolve the requesting user. Bearer data token takes precedence (deployed
 * apps); otherwise the session cookie via requireAuth (in-IDE preview).
 * requireAuth throws a redirect Response on failure — we catch and return null.
 */
async function resolveUser(request: Request, context: ActionFunctionArgs['context']): Promise<User | null> {
  const env = getCtxEnv(context);
  const auth = request.headers.get('Authorization') || '';

  if (auth.startsWith('Bearer ')) {
    const claims = validateDataApiToken(auth.slice(7), env);

    if (!claims) return null;

    return {
      id: claims.userId,
      email: '',
      isVerified: true,
      isModerator: false,
    };
  }

  try {
    return await requireAuth(request, context);
  } catch {
    return null;
  }
}

async function resolveTable(
  chatId: string,
  resource: string,
  user: User
): Promise<ResolvedContext | Response> {
  // Resource name must be a clean identifier before it even hits the registry.
  if (!VALID_COLUMN.test(resource)) {
    return json({ error: 'Invalid resource name' }, { status: 400 });
  }

  // Ownership / access — getChatById returns the chat row (incl. user_id) or
  // null when the user has no access. The schema is derived from chat.user_id
  // (the OWNER), not the requesting user, so the table is found in the owner's
  // schema regardless of who is calling.
  const chat = await getChatById(chatId, user.id, user.isModerator);

  if (!chat) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  // v1: strict schema-per-user, no sharing. Only the owner (or a moderator)
  // may access runtime data. Chat members who are not the owner get 403.
  if (chat.user_id !== user.id && !user.isModerator) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  // App-level isolation: the table must be registered to THIS chat. Another
  // app's table (even owned by the same user) is not visible by name here.
  const table = await getRegisteredTable(chat.id, resource);

  if (!table) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  // Defense-in-depth: the registry's schema_name must match the owner's schema.
  if (table.schema_name !== `usr_${chat.user_id.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`) {
    return json({ error: 'Schema mismatch' }, { status: 500 });
  }

  return { user, ownerId: chat.user_id, table };
}

function columnSet(table: AppTableMeta): Set<string> {
  return new Set((table.columns || []).map(c => c.name));
}

// GET — list rows
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const user = await resolveUser(request, context);

  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { chatId, resource } = params;

  if (!chatId || !resource) return json({ error: 'Bad route' }, { status: 400 });

  const resolved = await resolveTable(chatId, resource, user);

  if (resolved instanceof Response) return resolved;

  const { ownerId, table } = resolved;
  const cols = columnSet(table);
  const url = new URL(request.url);

  // select — whitelist against the registered columns; default to all.
  const selectRaw = url.searchParams.get('select') || '*';
  let selectCols: string[];

  if (selectRaw === '*') {
    selectCols = Array.from(cols);
  } else {
    selectCols = selectRaw.split(',').map(s => s.trim()).filter(Boolean);

    for (const c of selectCols) {
      if (!cols.has(c)) return json({ error: `Unknown column "${c}"` }, { status: 400 });
    }
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, MAX_ROWS);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  // Identifiers come from the registry (validated at import); double-quoted.
  const selectList = selectCols.map(c => `"${c}"`).join(', ');
  const sql = `SELECT ${selectList} FROM "${table.table_name}" ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
  const result = await runAppQuery(ownerId, sql, [limit, offset]);

  if (!result.ok) {
    return json({ error: result.error || 'Query failed' }, { status: 500 });
  }

  return json({ data: result.rows });
}

// POST/PATCH/DELETE
export async function action({ request, params, context }: ActionFunctionArgs) {
  const user = await resolveUser(request, context);

  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { chatId, resource } = params;

  if (!chatId || !resource) return json({ error: 'Bad route' }, { status: 400 });

  const resolved = await resolveTable(chatId, resource, user);

  if (resolved instanceof Response) return resolved;

  const { ownerId, table } = resolved;
  const cols = columnSet(table);
  const method = request.method.toUpperCase();

  if (method === 'POST') {
    let body: Record<string, unknown>;

    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Reject reserved / unknown columns. Values are parameterized (no injection).
    const entries = Object.entries(body).filter(([k]) => {
      if (['id', 'created_at', 'updated_at'].includes(k)) return false;
      return cols.has(k);
    });

    if (!entries.length) return json({ error: 'No valid columns to insert' }, { status: 400 });

    const colNames = entries.map(([k]) => `"${k}"`);
    const placeholders = entries.map((_, i) => `$${i + 1}`);
    const values = entries.map(([, v]) => v);
    const sql = `INSERT INTO "${table.table_name}" (${colNames.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;

    const result = await runAppQuery(ownerId, sql, values);

    if (!result.ok) {
      return json({ error: result.error || 'Insert failed' }, { status: 500 });
    }

    // Best-effort row-count bump in the registry.
    bumpRowCount(table, ownerId, entries.length).catch(() => {});

    return json({ data: result.rows?.[0] }, { status: 201 });
  }

  if (method === 'PATCH') {
    const id = new URL(request.url).searchParams.get('id');

    if (!id || !UUID_RE.test(id)) return json({ error: 'Valid ?id= required' }, { status: 400 });

    let body: Record<string, unknown>;

    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const entries = Object.entries(body).filter(([k]) => {
      if (['id', 'created_at', 'updated_at'].includes(k)) return false;
      return cols.has(k);
    });

    if (!entries.length) return json({ error: 'No valid columns to update' }, { status: 400 });

    const setClause = entries.map(([k], i) => `"${k}" = $${i + 1}`).join(', ');
    const values = entries.map(([, v]) => v);
    values.push(id);
    const sql = `UPDATE "${table.table_name}" SET ${setClause}, updated_at = now() WHERE id = $${values.length} RETURNING *`;

    const result = await runAppQuery(ownerId, sql, values);

    if (!result.ok) {
      return json({ error: result.error || 'Update failed' }, { status: 500 });
    }

    return json({ data: result.rows?.[0] });
  }

  if (method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id');

    if (!id || !UUID_RE.test(id)) return json({ error: 'Valid ?id= required' }, { status: 400 });

    const sql = `DELETE FROM "${table.table_name}" WHERE id = $1 RETURNING id`;
    const result = await runAppQuery(ownerId, sql, [id]);

    if (!result.ok) {
      return json({ error: result.error || 'Delete failed' }, { status: 500 });
    }

    return json({ data: { deleted: true, id: result.rows?.[0]?.id } });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
}

/** Best-effort registry row_count sync (not transactional with the mutation). */
async function bumpRowCount(table: AppTableMeta, _ownerId: string, _delta: number): Promise<void> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS c FROM "${table.schema_name}"."${table.table_name}"`
    );
    const count = rows[0]?.c ?? 0;

    await client.query(
      `UPDATE app_tables SET row_count = $1 WHERE schema_name = $2 AND table_name = $3`,
      [count, table.schema_name, table.table_name]
    );
  } finally {
    client.release();
  }
}
