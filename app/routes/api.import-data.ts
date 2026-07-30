/**
 * POST /api/import-data  — import a CSV/Excel-shaped dataset into the user's
 * runtime schema. Self-hosted PG (no Supabase). Schema-per-user (`usr_<userId>`).
 *
 * The client parses the file (papaparse/exceljs, lazy-imported in the modal) and
 * sends normalized JSON only — the server NEVER parses binary formats. The
 * server fully re-validates every cell via formatCellValue BEFORE any DDL, so a
 * hostile client bypassing the parser changes nothing.
 *
 * Flow: requireAuth -> rate limit -> isDataConfigured -> caps -> identifier
 * validation -> ownership (getChatById) -> provisionUserSchema -> validate
 * EVERY cell -> CREATE TABLE (no IF NOT EXISTS; double-quoted identifiers;
 * id/created_at/updated_at auto-added; user cols all nullable) -> chunked
 * inserts (~512KB/stmt) -> register in app_tables -> 409 if "already exists" ->
 * on insert failure best-effort DROP TABLE + 500.
 */
import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { checkRateLimit, getChatById } from '~/lib/database';
import { getPostgresPool } from '~/lib/database-postgresql';
import { provisionUserSchema, runAppQuery } from '~/lib/data-provision.server';
import { formatCellValue } from '~/utils/sqlDefaultValue';

const RESERVED_NAMES = new Set(['id', 'created_at', 'updated_at']);
const VALID_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

const PG_TYPES = new Set(['text', 'integer', 'numeric', 'boolean', 'timestamptz', 'uuid', 'jsonb']);

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_COLUMNS = 64;
const MAX_ROWS = 10_000;
const MAX_STRING_CELL = 10_000;
const INSERT_CHUNK_BYTES = 512 * 1024;

interface ImportColumn {
  name: string;
  type: string;
}

interface ImportBody {
  chatId: string;
  tableName: string;
  columns: ImportColumn[];
  rows: Array<Array<string | number | boolean | null>>;
}

export async function action({ request, context }: ActionFunctionArgs) {
  // 1. requireAuth throws a redirect Response — keep it outside try/catch.
  const user = await requireAuth(request, context);

  try {
    // 2. Rate limit — same shape as api.chat.ts.
    const allowed = await checkRateLimit(user.id, 'import', 5, 60);

    if (!allowed) {
      return json(
        { error: 'Too many imports. Try again in a minute.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    // 3. Data layer configured?
    if (!process.env.DATABASE_URL) {
      return json({ error: 'Data storage not configured' }, { status: 503 });
    }

    // 4. Caps — content-length first, then body size.
    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);

    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: 'Body too large (max 8 MB)' }, { status: 413 });
    }

    const rawText = await request.text();

    if (rawText.length > MAX_BODY_BYTES) {
      return json({ error: 'Body too large (max 8 MB)' }, { status: 413 });
    }

    let body: ImportBody;

    try {
      body = JSON.parse(rawText) as ImportBody;
    } catch {
      return json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { chatId, tableName, columns, rows } = body;

    if (!chatId || !tableName) {
      return json({ error: 'chatId and tableName are required' }, { status: 400 });
    }

    // 4b. Column / row caps.
    if (!Array.isArray(columns) || columns.length < 1 || columns.length > MAX_COLUMNS) {
      return json({ error: `Columns must be 1..${MAX_COLUMNS}` }, { status: 400 });
    }

    if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
      return json({ error: `Rows must be <= ${MAX_ROWS}` }, { status: 400 });
    }

    // 5. Identifier + type validation.
    if (!VALID_IDENTIFIER.test(tableName)) {
      return json(
        { error: 'Table name must be lowercase letters, digits, underscores, starting with a letter' },
        { status: 400 }
      );
    }

    if (RESERVED_NAMES.has(tableName)) {
      return json({ error: `Table name "${tableName}" is reserved` }, { status: 400 });
    }

    const seenCols = new Set<string>();

    for (const col of columns) {
      if (!col?.name || !VALID_IDENTIFIER.test(col.name)) {
        return json({ error: `Column name "${col?.name}" is invalid` }, { status: 400 });
      }

      if (RESERVED_NAMES.has(col.name)) {
        return json(
          { error: `Column "${col.name}" is reserved — id, created_at, updated_at are added automatically` },
          { status: 400 }
        );
      }

      if (seenCols.has(col.name)) {
        return json({ error: `Duplicate column name "${col.name}"` }, { status: 400 });
      }

      seenCols.add(col.name);

      if (!PG_TYPES.has(col.type)) {
        return json({ error: `Unknown column type "${col.type}"` }, { status: 400 });
      }
    }

    // 6. Ownership — getChatById returns null when the user has no access.
    const chat = await getChatById(chatId, user.id, user.isModerator);

    if (!chat) {
      return json({ error: 'Not found' }, { status: 404 });
    }

    // v1: strict schema-per-user, no sharing. Owner-only (moderator bypass).
    if (chat.user_id !== user.id && !user.isModerator) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    // 7. Provision the owner's schema (idempotent).
    const schemaName = await provisionUserSchema(chat.user_id);

    // 8. Validate EVERY cell BEFORE any DDL — failures leave no artifacts.
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];

      if (!Array.isArray(row) || row.length !== columns.length) {
        return json(
          { error: `Row ${r + 1} has ${row?.length ?? 0} cells; expected ${columns.length}` },
          { status: 400 }
        );
      }

      for (let c = 0; c < columns.length; c += 1) {
        const cell = row[c];
        const col = columns[c];

        if (typeof cell === 'string' && cell.length > MAX_STRING_CELL) {
          return json(
            { error: `Row ${r + 1}, column "${col.name}" exceeds ${MAX_STRING_CELL} chars` },
            { status: 400 }
          );
        }

        const literal = formatCellValue(col.type, cell);

        if (literal === null) {
          return json(
            { error: `Row ${r + 1}, column "${col.name}" (${col.type}) has an invalid value: ${JSON.stringify(cell)}` },
            { status: 400 }
          );
        }
      }
    }

    /*
     * 9. CREATE TABLE — NO IF NOT EXISTS (import must never mix into an existing
     *    table). Identifiers are double-quoted (VALID_IDENTIFIER guarantees no
     *    quotes inside). All user columns nullable (imported data has gaps).
     */
    const providedNames = new Set(columns.map(c => c.name));

    let autoColDefs = '';

    if (!providedNames.has('id')) {
      autoColDefs += '  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n';
    }

    if (!providedNames.has('created_at')) {
      autoColDefs += '  created_at timestamptz NOT NULL DEFAULT now(),\n';
    }

    if (!providedNames.has('updated_at')) {
      autoColDefs += '  updated_at timestamptz NOT NULL DEFAULT now(),\n';
    }

    const colDefs = columns.map(col => `  "${col.name}" ${col.type}`).join(',\n');

    const createSQL = `CREATE TABLE "${tableName}" (\n${autoColDefs}${colDefs}\n);`;

    const createResult = await runAppQuery(chat.user_id, createSQL);

    if (!createResult.ok) {
      const err = createResult.error || 'Failed to create table';

      if (/already exists/i.test(err)) {
        return json(
          { error: `Table "${tableName}" already exists in your schema — pick another name` },
          { status: 409 }
        );
      }

      return json({ error: err }, { status: 500 });
    }

    /*
     * 10. Chunked inserts. Accumulate rows until ~512KB of SQL, min 1 row/stmt.
     *     Identifiers double-quoted; values are parameterized ($1, $2, ...).
     *     Placeholders are recomputed per flush starting at $1.
     */
    const colList = columns.map(c => `"${c.name}"`).join(', ');
    let inserted = 0;

    const flush = async (batch: typeof rows) => {
      if (batch.length === 0) {
        return;
      }

      const params: unknown[] = [];
      let placeholderIdx = 1;
      const valuesSql = batch
        .map(row => {
          const ph = row.map(() => `$${placeholderIdx++}`).join(', ');

          params.push(...row);

          return `(${ph})`;
        })
        .join(', ');

      const sql = `INSERT INTO "${tableName}" (${colList}) VALUES ${valuesSql}`;
      const res = await runAppQuery(chat.user_id, sql, params);

      if (!res.ok) {
        throw new Error(res.error || 'Insert failed');
      }

      inserted += batch.length;
    };

    try {
      let batch: typeof rows = [];

      for (const row of rows) {
        batch.push(row);

        const approxBytes = batch.length * columns.length * 12;

        if (approxBytes >= INSERT_CHUNK_BYTES) {
          await flush(batch);
          batch = [];
        }
      }

      await flush(batch);
    } catch (insertErr) {
      // 11. Best-effort DROP TABLE — safe because step 9 proved we created it.
      await runAppQuery(chat.user_id, `DROP TABLE IF EXISTS "${tableName}"`).catch(() => {});

      return json({ error: insertErr instanceof Error ? insertErr.message : 'Insert failed' }, { status: 500 });
    }

    /*
     * 12. Register the table in app_tables so getSchemaContext + the data proxy
     *     can find it. ON CONFLICT DO NOTHING — if a stale row exists, the
     *     UNIQUE(schema_name, table_name) above would have 409'd at CREATE.
     */
    const pool = getPostgresPool();
    const regClient = await pool.connect();

    try {
      await regClient.query(
        `INSERT INTO app_tables (id, user_id, chat_id, schema_name, table_name, logical_name, columns, row_count, source)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 'import')
         ON CONFLICT (schema_name, table_name) DO UPDATE SET row_count = $7, columns = $6`,
        [
          cryptoRandomId(),
          chat.user_id,
          chat.id,
          schemaName,
          tableName,
          JSON.stringify(columns.map(c => ({ name: c.name, type: c.type }))),
          inserted,
        ]
      );
    } finally {
      regClient.release();
    }

    return json({
      success: true,
      schema: schemaName,
      tableName,
      rowCount: inserted,
      columnCount: columns.length,
    });
  } catch (error) {
    console.error('[api.import-data] error:', error);
    return json({ error: 'Import failed' }, { status: 500 });
  }
}

function cryptoRandomId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };

  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }

  return 'tbl_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
