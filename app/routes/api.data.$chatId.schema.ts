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
import { getPostgresPool, getCompanyIdForChatPostgres, personalCompanyId } from '~/lib/database-postgresql';
import {
  provisionUserSchema,
  provisionCompanySchema,
  runAppQuery,
  runAppQueryInSchema,
  listChatTables,
  physicalNameFor,
  listUserTables,
} from '~/lib/data-provision.server';
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

    /*
     * ?all=1 lists the user's tables across ALL their chats (for the
     * "Link existing table" flow); default lists only this chat's tables.
     */
    const all = new URL(request.url).searchParams.get('all') === '1';
    const tables = all ? await listUserTables(chat.user_id) : await listChatTables(chat.id);

    return json({
      configured: true,
      tables: tables.map(t => ({
        name: t.logical_name,
        columns: t.columns,
        row_count: t.row_count,
        category: t.category,
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
    columns?: ColumnInput[];
    linkExisting?: boolean;
    category?: string;
  };

  const { tableName, columns = [], linkExisting = false, category } = body;

  if (!tableName) {
    return json({ error: 'tableName is required' }, { status: 400 });
  }

  const tableErr = validateIdentifier(tableName, 'Table name');

  if (tableErr) {
    return json({ error: tableErr }, { status: 400 });
  }

  /*
   * Validated up front rather than on the fresh-create path alone: reusing a shared table can also
   * put these names into an ALTER TABLE, and validateColumns is what confines them to
   * [a-z][a-z0-9_]* before they reach any DDL.
   */
  const colsErr = validateColumns(columns);

  if (colsErr) {
    return json({ error: colsErr }, { status: 400 });
  }

  /*
   * W2: resolve the chat's workspace (personal vs company). If the chat's
   * project belongs to a real company (not the user's personal company),
   * tables are created in the shared cmp_<companyId> schema + tagged
   * workspace_type='company'. Otherwise, personal usr_<userId> (W1 behavior).
   */
  const companyId = await getCompanyIdForChatPostgres(chat.id);
  const isCompanyProject = !!companyId && companyId !== personalCompanyId(chat.user_id);

  let schemaName: string;
  let workspaceType: string;
  let workspaceId: string;

  if (isCompanyProject && companyId) {
    schemaName = await provisionCompanySchema(companyId);
    workspaceType = 'company';
    workspaceId = companyId;
  } else {
    schemaName = await provisionUserSchema(chat.user_id);
    workspaceType = 'personal';
    workspaceId = chat.user_id;
  }

  /*
   * Master data is shared across the workspace: an `employees` table built for one project is the
   * same table every later project gets, so reference data isn't rebuilt (and re-invented) per
   * app. Transactional tables stay project-scoped — merging one app's orders into another's would
   * be wrong. `linkExisting` remains an explicit opt-in for any table, master or not.
   *
   * Re-running the same chat's data action also lands here, finding the chat's own row. That is
   * deliberate: it makes the action idempotent and stops a second pass re-seeding the table.
   */
  const autoLinkMaster = !linkExisting && category === 'master';

  if (linkExisting || autoLinkMaster) {
    const pool = getPostgresPool();
    const linkClient = await pool.connect();

    /*
     * Tracked out here so the "nothing to reuse" fall-through happens after the client is
     * released, rather than releasing twice or running the fresh-create inside a try whose catch
     * would relabel its errors as link failures.
     */
    let didReuse = false;

    /*
     * Whether the table we linked to already holds data. Reuse alone isn't reason enough to skip
     * seeding — linking an empty master table and then skipping would leave every project sharing
     * it with no reference data at all.
     */
    let reusedTableHasRows = false;

    try {
      /*
       * Scoped to the workspace, not the creator: in a company, a colleague's `employees` table is
       * the company's master data and the next project should attach to it whoever built it.
       *
       * The `workspace_id IS NULL` arm matches rows written before that column existed, which are
       * personal by definition — so it is only consulted for personal workspaces. Applying it to a
       * company project would pull the builder's own old private tables into a schema every member
       * of the company can read and write.
       */
      const legacyPersonalRows = isCompanyProject ? '' : ' OR (workspace_id IS NULL AND user_id = $1)';

      /*
       * This chat's own registration wins over any other candidate. Re-running a data action must
       * land back on the table this project already owns; picking the row-richest namesake instead
       * would repoint the registration at someone else's table and strand this project's rows in a
       * physical table nothing references any more.
       */
      const existing = await linkClient.query(
        `SELECT schema_name, table_name, columns, row_count, category, workspace_type, workspace_id FROM app_tables
          WHERE (workspace_id = $1${legacyPersonalRows}) AND logical_name = $2
          ${autoLinkMaster ? `AND category = 'master'` : ''}
          ORDER BY (chat_id = $3) DESC, row_count DESC LIMIT 1`,
        [workspaceId, tableName, chat.id]
      );

      const existingRow = existing.rows[0];

      if (!existingRow) {
        if (linkExisting) {
          return json({ error: `No existing table named "${tableName}" to link` }, { status: 404 });
        }

        // Auto-link found nothing to share; the fresh-create below handles it.
      } else {
        didReuse = true;
        reusedTableHasRows = (existingRow.row_count ?? 0) > 0;

        const rawColumns = existingRow.columns;
        const parsedExisting: ColumnInput[] =
          typeof rawColumns === 'string' ? JSON.parse(rawColumns) : rawColumns || [];

        /*
         * The new app may want columns the shared table doesn't have yet. Add them rather than
         * forking a second copy — one table stays the source of truth, and projects that predate
         * the column simply never select it.
         */
        const mergedColumns = await extendSharedTable({
          userId: chat.user_id,
          schemaName: existingRow.schema_name,
          physicalName: existingRow.table_name,
          existing: parsedExisting,
          wanted: columns,
        });

        await linkClient.query(
          `INSERT INTO app_tables (id, user_id, chat_id, schema_name, table_name, logical_name, columns, row_count, source, category, workspace_type, workspace_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'relinked', $9, $10, $11)
           ON CONFLICT (chat_id, logical_name) DO UPDATE SET
             schema_name = EXCLUDED.schema_name,
             table_name = EXCLUDED.table_name,
             columns = EXCLUDED.columns,
             row_count = EXCLUDED.row_count,
             category = EXCLUDED.category,
             workspace_type = EXCLUDED.workspace_type,
             workspace_id = EXCLUDED.workspace_id`,
          [
            cryptoRandomId(),
            chat.user_id,
            chat.id,
            existingRow.schema_name,
            existingRow.table_name,
            tableName,
            JSON.stringify(mergedColumns),
            existingRow.row_count ?? 0,
            existingRow.category ?? category ?? null,
            existingRow.workspace_type ?? 'personal',
            existingRow.workspace_id ?? chat.user_id,
          ]
        );
      }
    } catch (linkErr) {
      return json(
        {
          error: `Could not link table "${tableName}": ${linkErr instanceof Error ? linkErr.message : String(linkErr)}`,
        },
        { status: 409 }
      );
    } finally {
      linkClient.release();
    }

    /*
     * `hasRows` is what tells the caller to skip seeding: the table already carries another
     * project's records and a second set of samples would land on top of them. A reused table that
     * is still empty must be seeded as normal, or every project sharing it ends up with nothing.
     */
    if (didReuse) {
      return json({
        success: true,
        tableName,
        schema: schemaName,
        relinked: true,
        reused: true,
        hasRows: reusedTableHasRows,
      });
    }
  }

  return await createFreshTable({ chat, tableName, columns, category, schemaName, workspaceType, workspaceId });
}

/**
 * Add columns the new app needs that the shared table lacks, returning the merged definition.
 *
 * Added nullable whatever the caller asked for: the table already holds other projects' rows, and
 * Postgres refuses ADD COLUMN ... NOT NULL on a populated table without a default.
 */
async function extendSharedTable(params: {
  userId: string;
  schemaName: string;
  physicalName: string;
  existing: ColumnInput[];
  wanted: ColumnInput[];
}): Promise<ColumnInput[]> {
  const have = new Set([...params.existing.map(col => col.name), ...RESERVED_NAMES]);
  const missing = params.wanted.filter(col => !have.has(col.name));

  if (missing.length === 0) {
    return params.existing;
  }

  const clauses = missing.map(col => `ADD COLUMN IF NOT EXISTS "${col.name}" ${PG_TYPES[col.type]}`);
  const result = await runAppQueryInSchema(
    params.userId,
    params.schemaName,
    `ALTER TABLE "${params.physicalName}" ${clauses.join(', ')};`
  );

  if (!result.ok) {
    throw new Error(result.error || 'Failed to add columns to the shared table');
  }

  return [...params.existing, ...missing.map(col => ({ ...col, nullable: true }))];
}

/** The original path: a fresh, chat-scoped physical table. */
async function createFreshTable(params: {
  chat: ChatRecord;
  tableName: string;
  columns: ColumnInput[];
  category?: string;
  schemaName: string;
  workspaceType: string;
  workspaceId: string;
}) {
  const { chat, tableName, columns, category, schemaName, workspaceType, workspaceId } = params;

  /*
   * Default: fresh table. A table with no user columns is unusable (only the
   * auto-managed id/created_at/updated_at exist, which the row form hides, so
   * "Add Row" dead-ends). Reject here as well as in the UI.
   */
  if (!columns || columns.length === 0) {
    return json({ error: 'Add at least one column — a table with no columns cannot store rows' }, { status: 400 });
  }

  /*
   * Chat-scoped physical name so each project's table is a separate physical
   * table even when two chats reuse the same logical name (e.g. both "orders")
   * — no cross-project data sharing. The logical_name (what the app/LLM uses)
   * stays `tableName`.
   */
  const physicalName = physicalNameFor(tableName, chat.id);
  const createSQL = buildCreateTableSQL(physicalName, columns);
  const result = await runAppQueryInSchema(chat.user_id, schemaName, createSQL);

  if (!result.ok) {
    const err = result.error || 'Failed to create table';

    if (/already exists/i.test(err)) {
      /*
       * Same chat re-running its data action (idempotent): the chat-scoped
       * physical table already exists for THIS chat. Re-ensure the registry row
       * and return success — no cross-chat re-link, no data pulled in.
       */
      const pool = getPostgresPool();
      const regClient = await pool.connect();

      try {
        await regClient.query(
          `INSERT INTO app_tables (id, user_id, chat_id, schema_name, table_name, logical_name, columns, row_count, source, category, workspace_type, workspace_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'manual', $8, $9, $10)
           ON CONFLICT (chat_id, logical_name) DO NOTHING`,
          [
            cryptoRandomId(),
            chat.user_id,
            chat.id,
            schemaName,
            physicalName,
            tableName,
            JSON.stringify(columns),
            category ?? null,
            workspaceType,
            workspaceId,
          ]
        );
      } finally {
        regClient.release();
      }

      return json({ success: true, tableName, schema: schemaName });
    }

    return json({ error: err }, { status: 500 });
  }

  // Register the table so getSchemaContext + the data proxy can find it.
  const pool = getPostgresPool();
  const regClient = await pool.connect();

  try {
    await regClient.query(
      `INSERT INTO app_tables (id, user_id, chat_id, schema_name, table_name, logical_name, columns, row_count, source, category, workspace_type, workspace_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'manual', $8, $9, $10)
         ON CONFLICT (chat_id, logical_name) DO NOTHING`,
      [
        cryptoRandomId(),
        chat.user_id,
        chat.id,
        schemaName,
        physicalName,
        tableName,
        JSON.stringify(columns),
        category ?? null,
        workspaceType,
        workspaceId,
      ]
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

  /*
   * Dropping a column is physical, and master tables are now shared across a workspace
   * automatically — so a drop here would delete that column, and its data, for every other project
   * reading the same table. handleDrop makes the same check before dropping a table; this is the
   * column-level equivalent. Adding columns stays allowed: it is additive and cannot break the
   * projects that don't know about the new column.
   */
  if (dropColumns.length > 0) {
    const pool = getPostgresPool();
    const sharedClient = await pool.connect();

    try {
      const others = await sharedClient.query(
        `SELECT 1 FROM app_tables WHERE schema_name = $1 AND table_name = $2 AND chat_id <> $3 LIMIT 1`,
        [registered.schemaName, registered.tableName, chat.id]
      );

      if (others.rows.length > 0) {
        return json(
          {
            error: `"${tableName}" is shared with other projects, so its columns can't be removed here. Remove the table from this project instead.`,
          },
          { status: 409 }
        );
      }
    } finally {
      sharedClient.release();
    }
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
