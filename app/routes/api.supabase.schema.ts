import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { schemaForChat, runAdminQuery, isSupabaseConfigured } from '~/lib/supabase-provision.server';

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

function buildCreateTableSQL(schema: string, tableName: string, columns: ColumnInput[]): string {
  const colDefs = columns.map(col => {
    const pgType = PG_TYPES[col.type] || 'text';
    const nullable = col.nullable ? '' : ' NOT NULL';
    const def = col.defaultValue ? ` DEFAULT ${col.defaultValue}` : '';

    return `  ${col.name} ${pgType}${nullable}${def}`;
  });

  return (
    [
      `CREATE TABLE IF NOT EXISTS ${schema}.${tableName} (`,
      `  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),`,
      `  created_at timestamptz NOT NULL DEFAULT now(),`,
      `  updated_at timestamptz NOT NULL DEFAULT now(),`,
      ...colDefs.map(d => `${d},`),
      // Remove trailing comma from last column
    ]
      .join('\n')
      .replace(/,\n\)/, '\n)') + ');'
  );
}

// GET /api/supabase/schema?chatId=X  — list tables in the app schema
export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    await requireAuth(request, context);

    const cfEnv = (context?.cloudflare?.env as unknown as Record<string, unknown>) ?? {};

    if (!isSupabaseConfigured(cfEnv)) {
      return json({ configured: false, tables: [] });
    }

    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get('chatId') ?? '';

    if (!chatId) {
      return json({ error: 'chatId is required' }, { status: 400 });
    }

    const supabaseUrl = (cfEnv.SUPABASE_URL as string) || process.env.SUPABASE_URL || '';
    const serviceKey = (cfEnv.SUPABASE_SERVICE_ROLE_KEY as string) || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const schema = schemaForChat(chatId);

    const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/pg/tables?schema=${schema}`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });

    if (!res.ok) {
      return json({ configured: true, tables: [] });
    }

    const tables = await res.json();

    return json({ configured: true, tables });
  } catch (error) {
    console.error('[api.supabase.schema] loader error:', error);
    return json({ error: 'Failed to list tables' }, { status: 500 });
  }
}

// POST /api/supabase/schema  — create a new table
export async function action({ request, context }: ActionFunctionArgs) {
  try {
    await requireAuth(request, context);

    const cfEnv = (context?.cloudflare?.env as unknown as Record<string, unknown>) ?? {};

    if (!isSupabaseConfigured(cfEnv)) {
      return json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const body = (await request.json()) as {
      chatId: string;
      tableName: string;
      columns: ColumnInput[];
    };

    const { chatId, tableName, columns } = body;

    if (!chatId || !tableName) {
      return json({ error: 'chatId and tableName are required' }, { status: 400 });
    }

    // Validate table name
    const tableErr = validateIdentifier(tableName, 'Table name');

    if (tableErr) {
      return json({ error: tableErr }, { status: 400 });
    }

    // Validate column names
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
    }

    const schema = schemaForChat(chatId);
    const createSQL = buildCreateTableSQL(schema, tableName, columns || []);

    const result = await runAdminQuery(createSQL, cfEnv);

    if (!result.ok) {
      return json({ error: result.error || 'Failed to create table' }, { status: 500 });
    }

    // Hot-reload PostgREST so it discovers the new table immediately
    await runAdminQuery(`NOTIFY pgrst, 'reload schema'`, cfEnv).catch(() => {});

    return json({ success: true, tableName, schema });
  } catch (error) {
    console.error('[api.supabase.schema] action error:', error);
    return json({ error: 'Failed to create table' }, { status: 500 });
  }
}
