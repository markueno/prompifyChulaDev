/**
 * Server-only: self-hosted runtime app-data layer (no Supabase).
 *
 * Each USER gets one PostgreSQL schema `usr_<userId>` inside the platform's own
 * PostgreSQL instance (same DATABASE_URL, same pool). This is the "schema-based
 * multitenancy" pattern (ARCHITECTURE-v2.md Part 2, doc line 291).
 *
 * Isolation layers (strongest -> weakest):
 *   1. Schema namespace — user A's `search_path` never includes user B's schema.
 *   2. Server-side ownership check — `getChatById(chatId, user.id)` gates every
 *      call; the client NEVER sends a schema selector.
 *   3. `SET LOCAL statement_timeout = 5s` + row caps on the proxy.
 *
 * No external Supabase calls. No anon/service-role key. No PostgREST.
 */
import { getPostgresPool, ensureAppTablesSchema } from '~/lib/database-postgresql';

const SCHEMA_PREFIX = 'usr_';
const VALID_SCHEMA_CHAR = /[^a-z0-9_]/g;
const STATEMENT_TIMEOUT_MS = 5000;

/**
 * Derive the per-user schema name. User IDs are UUIDs (contain hyphens), which
 * are illegal in unquoted Postgres identifiers — sanitize to underscores. The
 * result is always `[a-z0-9_]+` so it is safe to double-quote in DDL.
 */
export function schemaForUser(userId: string): string {
  const safe = (userId || '').toLowerCase().replace(VALID_SCHEMA_CHAR, '_');
  return `${SCHEMA_PREFIX}${safe}`;
}

/**
 * Idempotent: create the user's runtime schema if it does not exist. Safe to
 * call on every import / table-create. Returns the schema name (callers reuse
 * it to build quoted DDL).
 */
export async function provisionUserSchema(userId: string): Promise<string> {
  const schemaName = schemaForUser(userId);
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    return schemaName;
  } finally {
    client.release();
  }
}

export interface AppQueryResult {
  ok: boolean;
  rows?: Record<string, unknown>[];
  rowCount?: number | null;
  error?: string;
}

/**
 * Execute SQL inside the user's schema within a transaction. Sets
 * `search_path` + `statement_timeout` per transaction (LOCAL = scoped to the
 * tx, rolled back on error). The CALLER must verify ownership via
 * `getChatById(chatId, user.id)` before invoking — this function trusts the
 * userId it receives.
 *
 * Pass a single statement (or a multi-statement string with no params). Params
 * bind only to the first statement when multi-statement strings are used.
 */
export async function runAppQuery(
  userId: string,
  sql: string,
  params: unknown[] = []
): Promise<AppQueryResult> {
  const schemaName = schemaForUser(userId);
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL search_path TO "${schemaName}"`);
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}'`);
    const result = await client.query(sql, params);
    await client.query('COMMIT');
    return { ok: true, rows: result.rows, rowCount: result.rowCount };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}

export interface AppTableMeta {
  logical_name: string;
  table_name: string;
  schema_name: string;
  columns: Array<{ name: string; type: string }>;
  row_count: number;
}

/**
 * Look up a (chatId, logicalName) in the registry. Returns null if the table is
 * not registered to THIS chat — which means the request must 404 (app-level
 * isolation within a user: app A cannot read app B's tables by name).
 */
export async function getRegisteredTable(
  chatId: string,
  logicalName: string
): Promise<AppTableMeta | null> {
  // Day 20 — ensure the registry table exists (getPostgresPool doesn't run migrations).
  await ensureAppTablesSchema();
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `SELECT logical_name, table_name, schema_name, columns, row_count
       FROM app_tables
       WHERE chat_id = $1 AND logical_name = $2
       LIMIT 1`,
      [chatId, logicalName]
    );

    if (!rows.length) return null;

    const row = rows[0];
    const columns = Array.isArray(row.columns) ? row.columns : JSON.parse(row.columns || '[]');

    return {
      logical_name: row.logical_name,
      table_name: row.table_name,
      schema_name: row.schema_name,
      columns,
      row_count: row.row_count ?? 0,
    };
  } finally {
    client.release();
  }
}

/**
 * List all app tables registered to a chat (for the Database panel + the data
 * proxy schema route). Per-chat scoping: a user's OTHER app tables are hidden.
 */
export async function listChatTables(chatId: string): Promise<AppTableMeta[]> {
  // Day 20 — ensure the registry table exists (getPostgresPool doesn't run migrations).
  await ensureAppTablesSchema();
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `SELECT logical_name, table_name, schema_name, columns, row_count
       FROM app_tables
       WHERE chat_id = $1
       ORDER BY logical_name`,
      [chatId]
    );

    return rows.map((row: Record<string, unknown>) => {
      const cols = row.columns;
      const columns = Array.isArray(cols) ? cols : JSON.parse((cols as string) || '[]');

      return {
        logical_name: row.logical_name as string,
        table_name: row.table_name as string,
        schema_name: row.schema_name as string,
        columns,
        row_count: (row.row_count as number) ?? 0,
      };
    });
  } finally {
    client.release();
  }
}

/**
 * Fetch the current schema for a chat's app and return a formatted markdown
 * string ready to inject into the LLM system prompt. Instructs the LLM to
 * generate fetch()-against-data-proxy code (NOT Supabase SDK). Returns null
 * when the chat has no registered tables yet.
 *
 * The second arg (cloudflareEnv) is accepted for backwards-compat with the
 * existing caller in stream-text.ts and is intentionally unused — this layer
 * reads no external env, it uses the platform's own PG.
 */
export async function getSchemaContext(
  chatId: string,
  _cloudflareEnv?: Record<string, unknown>
): Promise<string | null> {
  const tables = await listChatTables(chatId);

  if (!tables.length) return null;

  const lines: string[] = [
    '## App Database (self-hosted, Remix data proxy)',
    '',
    'This app reads/writes its data through the Prompify data proxy. The runtime',
    'config is injected into `window.__PROMPIFY_CONFIG` by `/env-config.js`.',
    '',
    '**Always access data exactly like this:**',
    '```js',
    'const cfg = window.__PROMPIFY_CONFIG || {};',
    '// GET rows',
    "const res = await fetch(`${cfg.apiUrl}/${cfg.chatId}/${tableName}`, {",
    "  headers: { Authorization: `Bearer ${cfg.token}` }",
    '});',
    'const { data } = await res.json();',
    '// INSERT a row',
    'await fetch(`${cfg.apiUrl}/${cfg.chatId}/${tableName}`, {',
    '  method: "POST",',
    '  headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.token}` },',
    '  body: JSON.stringify(row)',
    '});',
    '```',
    '',
    '**Existing tables:**',
  ];

  for (const table of tables) {
    lines.push(`\n### ${table.logical_name} (${table.row_count} rows)`);

    const cols = (table.columns || []).map(c => `  - ${c.name}: ${c.type}`);

    lines.push(...cols);
  }

  lines.push(
    '',
    '**Rules when generating database code:**',
    '- Add `<script src="/env-config.js"></script>` inside `<head>` of index.html BEFORE any other scripts',
    '- Use `fetch()` against `${cfg.apiUrl}/${cfg.chatId}/${table}` for all CRUD (GET/POST/PATCH/DELETE)',
    '- `{ data }` is the row array for GET; mutations return the affected row',
    '- The `id`, `created_at`, `updated_at` columns are auto-managed — never insert them manually'
  );

  return lines.join('\n');
}

/**
 * Backwards-compat shim: kept so legacy callers that imported `isSupabaseConfigured`
 * compile during the migration. Self-hosted data is always "configured" when PG is.
 */
export function isDataConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}
