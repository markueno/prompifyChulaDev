/**
 * GET  /api/data/:chatId/schema  — list the chat's registered app tables.
 * POST /api/data/:chatId/schema  — create a new empty table (manual / LLM-driven).
 *
 * Replaces api.supabase.schema.ts (which proxied to Supabase postgres-meta).
 * Tables are created in the OWNER's `usr_<userId>` schema and registered in the
 * `app_tables` registry so getSchemaContext + the data proxy can find them.
 *
 * Identifier validation, reserved names, and the H-3 default-value guard are
 * preserved verbatim from the prior Supabase route — they are
 * Supabase-agnostic.
 */
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { getChatById } from '~/lib/database';
import { getPostgresPool } from '~/lib/database-postgresql';
import { provisionUserSchema, runAppQuery, listChatTables } from '~/lib/data-provision.server';
import { formatDefaultValue } from '~/utils/sqlDefaultValue';

const RESERVED_NAMES = new Set(['id', 'created_at', 'updated_at']);
const VALID_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

const PG_TYPES: Record<string, string> = {
  text: 'text',
  integer: 'integer',
  numeric: 'numeric',
  boolean: 'boolean',
  timestamptz: 'timestamptz',
  uuid: 'uuid',
  jsonb: 'jsonb',
};

interface ColumnInput {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
}

function validateIdentifier(name: string, label: string): string | null {
  if (!VALID_IDENTIFIER.test(name)) {
    return `${label} "${name}" is invalid — use lowercase letters, digits, and underscores only, starting with a letter`;
  }

  return null;
}

function buildCreateTableSQL(tableName: string, columns: ColumnInput[]): string {
  const userColDefs = columns.map(col => {
    const pgType = PG_TYPES[col.type] || 'text';
    const nullable = col.nullable ? '' : ' NOT NULL';
    const safeDefault = col.defaultValue ? formatDefaultValue(pgType, col.defaultValue) : null;
    const def = safeDefault ? ` DEFAULT ${safeDefault}` : '';

    return `  "${col.name}" ${pgType}${nullable}${def}`;
  });

  // Auto columns first (matches the import route's CREATE TABLE order).
  const allDefs = [
    '  id uuid PRIMARY KEY DEFAULT gen_random_uuid()',
    '  created_at timestamptz NOT NULL DEFAULT now()',
    '  updated_at timestamptz NOT NULL DEFAULT now()',
    ...userColDefs,
  ];

  /*
   * Join with ",\n" so there is never a trailing comma before the closing ")".
   * (The previous build appended ",);" — a trailing comma that produced
   * "syntax error at or near ')'" whenever the table was created, especially
   * with zero user columns.)
   */
  return `CREATE TABLE "${tableName}" (\n${allDefs.join(',\n')}\n);`;
}

// GET — list tables registered to this chat
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const user = await requireAuth(request, context);
  const { chatId } = params;

  if (!chatId) {
    return json({ error: 'chatId is required' }, { status: 400 });
  }

  try {
    const chat = await getChatById(chatId, user.id, user.isModerator);

    if (!chat) {
      return json({ error: 'Not found' }, { status: 404 });
    }

    const tables = await listChatTables(chat.id);

    return json({
      configured: true,
      tables: tables.map(t => ({
        name: t.logical_name,
        columns: t.columns,
        row_count: t.row_count,
      })),
    });
  } catch (error) {
    console.error('[api.data.schema] loader error:', error);
    return json({ error: 'Failed to list tables' }, { status: 500 });
  }
}

// POST — create a new table in the owner's schema + register it
export async function action({ request, params, context }: ActionFunctionArgs) {
  const user = await requireAuth(request, context);
  const { chatId } = params;

  if (!chatId) {
    return json({ error: 'chatId is required' }, { status: 400 });
  }

  try {
    const chat = await getChatById(chatId, user.id, user.isModerator);

    if (!chat) {
      return json({ error: 'Not found' }, { status: 404 });
    }

    // v1: owner-only (no sharing). Moderator bypass is allowed.
    if (chat.user_id !== user.id && !user.isModerator) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as {
      tableName: string;
      columns: ColumnInput[];
    };

    const { tableName, columns } = body;

    if (!tableName) {
      return json({ error: 'tableName is required' }, { status: 400 });
    }

    const tableErr = validateIdentifier(tableName, 'Table name');

    if (tableErr) {
      return json({ error: tableErr }, { status: 400 });
    }

    for (const col of columns || []) {
      if (RESERVED_NAMES.has(col.name)) {
        return json(
          { error: `Column "${col.name}" is reserved — id, created_at, and updated_at are added automatically` },
          { status: 400 }
        );
      }

      const colErr = validateIdentifier(col.name, 'Column name');

      if (colErr) {
        return json({ error: colErr }, { status: 400 });
      }

      if (!PG_TYPES[col.type]) {
        return json({ error: `Unknown column type "${col.type}"` }, { status: 400 });
      }

      if (col.defaultValue && formatDefaultValue(PG_TYPES[col.type], col.defaultValue) === null) {
        return json({ error: `Default value for "${col.name}" is not valid for type ${col.type}` }, { status: 400 });
      }
    }

    const schemaName = await provisionUserSchema(chat.user_id);
    const createSQL = buildCreateTableSQL(tableName, columns || []);
    const result = await runAppQuery(chat.user_id, createSQL);

    if (!result.ok) {
      const err = result.error || 'Failed to create table';

      if (/already exists/i.test(err)) {
        return json({ error: `Table "${tableName}" already exists — pick another name` }, { status: 409 });
      }

      return json({ error: err }, { status: 500 });
    }

    // Register the table so getSchemaContext + the data proxy can find it.
    const pool = getPostgresPool();
    const regClient = await pool.connect();

    try {
      await regClient.query(
        `INSERT INTO app_tables (id, user_id, chat_id, schema_name, table_name, logical_name, columns, row_count, source)
         VALUES ($1, $2, $3, $4, $5, $5, $6, 0, 'manual')
         ON CONFLICT (schema_name, table_name) DO NOTHING`,
        [cryptoRandomId(), chat.user_id, chat.id, schemaName, tableName, JSON.stringify(columns || [])]
      );
    } finally {
      regClient.release();
    }

    return json({ success: true, tableName, schema: schemaName });
  } catch (error) {
    console.error('[api.data.schema] action error:', error);
    return json({ error: 'Failed to create table' }, { status: 500 });
  }
}

function cryptoRandomId(): string {
  /*
   * Avoid importing node:crypto at module top for a tiny util; use Web Crypto
   * when available, fall back to Math.random-based (sufficient for a PK here
   * since schema+table uniqueness is the real constraint).
   */
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };

  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }

  return 'tbl_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
