/**
 * GET    /api/data/:chatId/schema         — list the chat's registered app tables.
 * POST   /api/data/:chatId/schema         — create a new table (manual / LLM-driven).
 * PATCH  /api/data/:chatId/schema         — add/drop columns on an existing table.
 * DELETE /api/data/:chatId/schema?table=x — drop a table and deregister it.
 *
 * PATCH takes the table name in the JSON body; DELETE takes it as a query param (a body on
 * DELETE is legal but not universally forwarded, and this endpoint is called from the browser).
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

const VALID_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

/*
 * id/created_at/updated_at are always added automatically (id is the PK the data proxy uses
 * for update/delete); user columns may not reuse these names.
 */
const RESERVED_NAMES = new Set(['id', 'created_at', 'updated_at']);

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

  /*
   * id/created_at/updated_at are always added with their proper PK/defaults (reserved names are
   * rejected above, so they never collide with user columns). id is the PRIMARY KEY the data
   * proxy relies on for update/delete. Auto columns first, matching the import route's order.
   */
  const allDefs = [
    '  id uuid PRIMARY KEY DEFAULT gen_random_uuid()',
    '  created_at timestamptz NOT NULL DEFAULT now()',
    '  updated_at timestamptz NOT NULL DEFAULT now()',
    ...userColDefs,
  ];

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

/** Validate a batch of column definitions. Returns an error message, or null when all are OK. */
function validateColumns(columns: ColumnInput[]): string | null {
  for (const col of columns) {
    if (RESERVED_NAMES.has(col.name)) {
      return `Column "${col.name}" is reserved — id, created_at, and updated_at are added automatically`;
    }

    const colErr = validateIdentifier(col.name, 'Column name');

    if (colErr) {
      return colErr;
    }

    if (!PG_TYPES[col.type]) {
      return `Unknown column type "${col.type}"`;
    }

    if (col.defaultValue && formatDefaultValue(PG_TYPES[col.type], col.defaultValue) === null) {
      return `Default value for "${col.name}" is not valid for type ${col.type}`;
    }
  }

  return null;
}

interface RegisteredTable {
  schemaName: string;
  tableName: string;
  columns: ColumnInput[];
}

/**
 * Resolve a logical table name against the registry for this chat. The physical name always comes
 * from `app_tables`, never from the request, so a caller cannot address a table it doesn't own.
 */
async function lookupRegisteredTable(chatId: string, logicalName: string): Promise<RegisteredTable | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `SELECT schema_name, table_name, columns FROM app_tables WHERE chat_id = $1 AND logical_name = $2 LIMIT 1`,
      [chatId, logicalName]
    );

    if (rows.length === 0) {
      return null;
    }

    const raw = rows[0].columns;

    return {
      schemaName: rows[0].schema_name as string,
      tableName: rows[0].table_name as string,
      columns: Array.isArray(raw) ? raw : JSON.parse((raw as string) || '[]'),
    };
  } finally {
    client.release();
  }
}

/** Keep the registry in step with the physical table — it is what the UI and the AI read. */
async function writeRegistryColumns(schemaName: string, tableName: string, columns: ColumnInput[]): Promise<void> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(`UPDATE app_tables SET columns = $3 WHERE schema_name = $1 AND table_name = $2`, [
      schemaName,
      tableName,
      JSON.stringify(columns),
    ]);
  } finally {
    client.release();
  }
}

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

    switch (request.method.toUpperCase()) {
      case 'POST':
        return await handleCreate(request, chat);
      case 'PATCH':
        return await handleAlter(request, chat);
      case 'DELETE':
        return await handleDrop(request, chat);
      default:
        return json({ error: `Method ${request.method} not allowed` }, { status: 405 });
    }
  } catch (error) {
    console.error('[api.data.schema] action error:', error);
    return json({ error: 'Schema operation failed' }, { status: 500 });
  }
}

type ChatRecord = { id: string; user_id: string };

// POST — create a new table in the owner's schema + register it
async function handleCreate(request: Request, chat: ChatRecord) {
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

  /*
   * A table with no user columns is unusable: the only columns are the auto-managed
   * id/created_at/updated_at, which the row form hides, so "Add Row" has nothing to insert and
   * dead-ends on "No valid columns to insert". Reject it here as well as in the UI.
   */
  if (!columns || columns.length === 0) {
    return json({ error: 'Add at least one column — a table with no columns cannot store rows' }, { status: 400 });
  }

  const colsErr = validateColumns(columns);

  if (colsErr) {
    return json({ error: colsErr }, { status: 400 });
  }

  const schemaName = await provisionUserSchema(chat.user_id);
  const createSQL = buildCreateTableSQL(tableName, columns);
  const result = await runAppQuery(chat.user_id, createSQL);

  if (!result.ok) {
    const err = result.error || 'Failed to create table';

    if (/already exists/i.test(err)) {
      /*
       * The physical table already exists in this user's schema — almost always
       * because it was created under a DIFFERENT chat (common when an app is
       * rebuilt/regenerated in a new chat). Instead of 409-ing and leaving the
       * data invisible to the current chat, re-link the existing table to THIS
       * chat so its rows show up in the Data tab and resolve via the data proxy.
       * Columns come from the existing registry row (the physical table's actual
       * schema) because a CREATE cannot reshape an already-existing table.
       */
      const pool = getPostgresPool();
      const linkClient = await pool.connect();

      try {
        const existing = await linkClient.query(
          `SELECT columns, row_count FROM app_tables
            WHERE schema_name = $1 AND table_name = $2
            ORDER BY row_count DESC LIMIT 1`,
          [schemaName, tableName]
        );

        const existingRow = existing.rows[0];
        const rawColumns = existingRow?.columns ?? columns;
        const existingColumns = typeof rawColumns === 'string' ? rawColumns : JSON.stringify(rawColumns);
        const existingRowCount = existingRow?.row_count ?? 0;

        await linkClient.query(
          `INSERT INTO app_tables (id, user_id, chat_id, schema_name, table_name, logical_name, columns, row_count, source)
           VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 'relinked')
           ON CONFLICT (chat_id, logical_name) DO UPDATE SET
             columns = EXCLUDED.columns,
             row_count = EXCLUDED.row_count`,
          [cryptoRandomId(), chat.user_id, chat.id, schemaName, tableName, existingColumns, existingRowCount]
        );
      } catch (linkErr) {
        return json(
          {
            error: `Table "${tableName}" already exists and could not be linked to this chat: ${
              linkErr instanceof Error ? linkErr.message : String(linkErr)
            }`,
          },
          { status: 409 }
        );
      } finally {
        linkClient.release();
      }

      return json({ success: true, tableName, schema: schemaName, relinked: true });
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
         ON CONFLICT (chat_id, logical_name) DO NOTHING`,
      [cryptoRandomId(), chat.user_id, chat.id, schemaName, tableName, JSON.stringify(columns)]
    );
  } finally {
    regClient.release();
  }

  return json({ success: true, tableName, schema: schemaName });
}

// PATCH — add and/or drop columns on an existing table
async function handleAlter(request: Request, chat: ChatRecord) {
  const body = (await request.json()) as {
    tableName: string;
    addColumns?: ColumnInput[];
    dropColumns?: string[];
  };

  const { tableName, addColumns = [], dropColumns = [] } = body;

  if (!tableName) {
    return json({ error: 'tableName is required' }, { status: 400 });
  }

  if (addColumns.length === 0 && dropColumns.length === 0) {
    return json({ error: 'Nothing to change' }, { status: 400 });
  }

  const registered = await lookupRegisteredTable(chat.id, tableName);

  if (!registered) {
    return json({ error: `Table "${tableName}" not found` }, { status: 404 });
  }

  const addErr = validateColumns(addColumns);

  if (addErr) {
    return json({ error: addErr }, { status: 400 });
  }

  const existing = new Set(registered.columns.map(c => c.name));

  for (const col of addColumns) {
    if (existing.has(col.name)) {
      return json({ error: `Column "${col.name}" already exists on "${tableName}"` }, { status: 409 });
    }

    /*
     * Postgres rejects ADD COLUMN ... NOT NULL on a table that already has rows unless a default
     * is supplied. Say so up front rather than surfacing a raw PG error.
     */
    if (!col.nullable && !col.defaultValue) {
      return json(
        { error: `Column "${col.name}" is required, so it needs a default value to be added to an existing table` },
        { status: 400 }
      );
    }
  }

  for (const name of dropColumns) {
    if (RESERVED_NAMES.has(name)) {
      return json({ error: `Column "${name}" is managed by the platform and cannot be removed` }, { status: 400 });
    }

    const nameErr = validateIdentifier(name, 'Column name');

    if (nameErr) {
      return json({ error: nameErr }, { status: 400 });
    }

    if (!existing.has(name)) {
      return json({ error: `Column "${name}" does not exist on "${tableName}"` }, { status: 404 });
    }
  }

  if (dropColumns.length >= registered.columns.length + addColumns.length) {
    return json({ error: 'A table must keep at least one column' }, { status: 400 });
  }

  const clauses = [
    ...addColumns.map(col => {
      const pgType = PG_TYPES[col.type];
      const nullable = col.nullable ? '' : ' NOT NULL';
      const safeDefault = col.defaultValue ? formatDefaultValue(pgType, col.defaultValue) : null;
      const def = safeDefault ? ` DEFAULT ${safeDefault}` : '';

      return `ADD COLUMN "${col.name}" ${pgType}${nullable}${def}`;
    }),
    ...dropColumns.map(name => `DROP COLUMN "${name}"`),
  ];

  // One statement, so a partial failure leaves the table exactly as it was.
  const result = await runAppQuery(chat.user_id, `ALTER TABLE "${registered.tableName}" ${clauses.join(', ')};`);

  if (!result.ok) {
    return json({ error: result.error || 'Failed to update columns' }, { status: 500 });
  }

  const dropped = new Set(dropColumns);
  const nextColumns = [...registered.columns.filter(c => !dropped.has(c.name)), ...addColumns];
  await writeRegistryColumns(registered.schemaName, registered.tableName, nextColumns);

  return json({ success: true, tableName, columns: nextColumns });
}

// DELETE — drop a table and remove it from the registry
async function handleDrop(request: Request, chat: ChatRecord) {
  const tableName = new URL(request.url).searchParams.get('table');

  if (!tableName) {
    return json({ error: 'table query parameter is required' }, { status: 400 });
  }

  const registered = await lookupRegisteredTable(chat.id, tableName);

  if (!registered) {
    return json({ error: `Table "${tableName}" not found` }, { status: 404 });
  }

  const pool = getPostgresPool();
  const client = await pool.connect();

  let dropPhysical = false;

  try {
    /*
     * With multi-chat registration the same physical table can be linked into
     * several chats. Only drop the physical table when no OTHER chat still
     * references it, so deleting a table from one chat never destroys data shared
     * with another. Deregister this chat's link either way.
     */
    const other = await client.query(
      `SELECT 1 FROM app_tables
        WHERE schema_name = $1 AND table_name = $2 AND chat_id <> $3
        LIMIT 1`,
      [registered.schemaName, registered.tableName, chat.id]
    );

    dropPhysical = other.rows.length === 0;

    await client.query(`DELETE FROM app_tables WHERE chat_id = $1 AND logical_name = $2`, [chat.id, tableName]);
  } finally {
    client.release();
  }

  if (!dropPhysical) {
    return json({ success: true, tableName, dropped: false });
  }

  const result = await runAppQuery(chat.user_id, `DROP TABLE IF EXISTS "${registered.tableName}" CASCADE;`);

  if (!result.ok) {
    return json({ error: result.error || 'Failed to delete table' }, { status: 500 });
  }

  return json({ success: true, tableName, dropped: true });
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
