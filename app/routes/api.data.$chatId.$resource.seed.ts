/**
 * POST /api/data/:chatId/:resource/seed — bulk-insert sample rows in one
 * transaction.
 *
 * Body: { rows: [ {col: val, ...}, ... ] }
 *
 * Mirrors the auth/resolution/CORS of api.data.$chatId.$resource.ts. The schema
 * is derived SERVER-SIDE from the chat owner — the client never sends a schema
 * selector. Only the chat owner (or a moderator) may seed.
 *
 * Used by:
 *   - The <boltAction type="data"> handler in action-runner.ts (during AI
 *     generation, from the Prompify browser tab — session cookie auth).
 *   - The "Generate sample data" button in AdminDataSection (retroactive
 *     seeding on an existing empty table).
 */
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth, type User } from '~/lib/auth';
import { getChatById } from '~/lib/database';
import { getPostgresPool } from '~/lib/database-postgresql';
import { getRegisteredTable, runAppQuery, type AppTableMeta } from '~/lib/data-provision.server';
import { validateDataApiToken } from '~/lib/.server/data-token';

const MAX_SEED_ROWS = 200;
const WEBCONTAINER_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.local-credentialless\.webcontainer-api\.io$/;

function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '';

  if (!WEBCONTAINER_ORIGIN_RE.test(origin)) {
    return {};
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    Vary: 'Origin',
  };

  if (request.headers.get('Access-Control-Request-Private-Network') === 'true') {
    headers['Access-Control-Allow-Private-Network'] = 'true';
  }

  return headers;
}

function getCtxEnv(context: ActionFunctionArgs['context']): Record<string, unknown> {
  return (context?.cloudflare?.env as unknown as Record<string, unknown>) ?? {};
}

async function resolveUser(request: Request, context: ActionFunctionArgs['context']): Promise<User | null> {
  const env = getCtxEnv(context);
  const auth = request.headers.get('Authorization') || '';

  if (auth.startsWith('Bearer ')) {
    const claims = validateDataApiToken(auth.slice(7), env);

    if (!claims) {
      return null;
    }

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

interface ResolvedContext {
  user: User;
  ownerId: string;
  table: AppTableMeta;
}

async function resolveTable(chatId: string, resource: string, user: User): Promise<ResolvedContext | Response> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(resource)) {
    return json({ error: 'Invalid resource name' }, { status: 400 });
  }

  const chat = await getChatById(chatId, user.id, user.isModerator);

  if (!chat) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  if (chat.user_id !== user.id && !user.isModerator) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const table = await getRegisteredTable(chat.id, resource);

  if (!table) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  if (table.schema_name !== `usr_${chat.user_id.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`) {
    return json({ error: 'Schema mismatch' }, { status: 500 });
  }

  return { user, ownerId: chat.user_id, table };
}

function columnSet(table: AppTableMeta): Set<string> {
  return new Set((table.columns || []).map(c => c.name));
}

export async function action(args: ActionFunctionArgs) {
  if (args.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeadersFor(args.request) });
  }

  const user = await resolveUser(args.request, args.context);

  if (!user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { chatId, resource } = args.params;

  if (!chatId || !resource) {
    return json({ error: 'Bad route' }, { status: 400 });
  }

  const resolved = await resolveTable(chatId, resource, user);

  if (resolved instanceof Response) {
    return resolved;
  }

  const { ownerId, table } = resolved;
  const cols = columnSet(table);

  let body: { rows?: Record<string, unknown>[] };

  try {
    body = (await args.request.json()) as { rows?: Record<string, unknown>[] };
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];

  if (rows.length === 0) {
    return json({ error: 'No rows to seed' }, { status: 400 });
  }

  if (rows.length > MAX_SEED_ROWS) {
    return json({ error: `Too many rows (max ${MAX_SEED_ROWS})` }, { status: 413 });
  }

  /*
   * Build a single multi-row INSERT. Each row may have a different subset of
   * columns (the AI's sample rows aren't guaranteed to be uniform), so we use
   * the UNION of all row keys that are in the column whitelist, and NULL for
   * missing ones.
   *
   * Reserved columns (id, created_at, updated_at) are always excluded — they
   * are auto-managed by the table's DEFAULT gen_random_uuid() / now().
   */
  const RESERVED = new Set(['id', 'created_at', 'updated_at']);

  const allKeys = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!RESERVED.has(key) && cols.has(key)) {
        allKeys.add(key);
      }
    }
  }

  if (allKeys.size === 0) {
    return json({ error: 'No valid columns to insert' }, { status: 400 });
  }

  const colNames = Array.from(allKeys);
  const quotedCols = colNames.map(c => `"${c}"`).join(', ');

  /*
   * Build the VALUES clause: each row contributes one ($n, $n+1, ...) group.
   * Missing keys for a row get DEFAULT (Postgres fills in the column default
   * or NULL). Using DEFAULT rather than NULL preserves NOT NULL columns that
   * have a default (e.g. a boolean column DEFAULT false).
   */
  const valueGroups: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  for (const row of rows) {
    const group: string[] = [];

    for (const col of colNames) {
      if (col in row) {
        group.push(`$${paramIdx}`);
        params.push(row[col]);
        paramIdx++;
      } else {
        group.push('DEFAULT');
      }
    }

    valueGroups.push(`(${group.join(', ')})`);
  }

  const sql = `INSERT INTO "${table.table_name}" (${quotedCols}) VALUES ${valueGroups.join(', ')} RETURNING id`;

  const result = await runAppQuery(ownerId, sql, params);

  if (!result.ok) {
    return json({ error: result.error || 'Seed failed' }, { status: 500 });
  }

  /*
   * Best-effort row-count sync in the registry (same pattern as the single-row
   * POST in the resource route). Non-transactional — a failure here just means
   * the registry shows a stale count until the next list refresh.
   */
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS c FROM "${table.schema_name}"."${table.table_name}"`
    );
    const count = countRows[0]?.c ?? 0;

    await client.query(`UPDATE app_tables SET row_count = $1 WHERE schema_name = $2 AND table_name = $3`, [
      count,
      table.schema_name,
      table.table_name,
    ]);
  } finally {
    client.release();
  }

  return json({ inserted: result.rows?.length ?? 0, row_count: result.rows?.length ?? 0 });
}

export function loader({ request }: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeadersFor(request) });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
}
