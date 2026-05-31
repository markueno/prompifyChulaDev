/**
 * Server-only: provisions an isolated PostgreSQL schema for one app/chat.
 * Called fire-and-forget when a new chat is created.
 *
 * Uses the Supabase postgres-meta API  (/pg/schemas) which is exposed
 * through the Kong gateway — no direct DB connection needed.
 *
 * If SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set, this is a no-op
 * so the platform degrades gracefully when Supabase is not configured.
 */

function getEnv(key: string, ctx?: Record<string, unknown>): string {
  return (ctx?.[key] as string) || (process.env[key] as string) || '';
}

export async function provisionAppSchema(chatId: string, cloudflareEnv?: Record<string, unknown>): Promise<void> {
  const supabaseUrl = getEnv('SUPABASE_URL', cloudflareEnv);
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY', cloudflareEnv);

  if (!supabaseUrl || !serviceKey) {
    return;
  }

  const schemaName = `app_${chatId.replace(/-/g, '_')}`;
  const base = supabaseUrl.replace(/\/$/, '');

  try {
    const res = await fetch(`${base}/pg/schemas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ name: schemaName }),
    });

    // 409 = schema already exists → fine, idempotent
    if (!res.ok && res.status !== 409) {
      console.error(`[supabase-provision] Failed to create schema "${schemaName}": HTTP ${res.status}`);
    }
  } catch (err) {
    // Never crash the caller — Supabase provisioning is best-effort
    console.error('[supabase-provision] Error:', err);
  }
}

export function schemaForChat(chatId: string): string {
  return `app_${chatId.replace(/-/g, '_')}`;
}

export function isSupabaseConfigured(cloudflareEnv?: Record<string, unknown>): boolean {
  return !!(getEnv('SUPABASE_URL', cloudflareEnv) && getEnv('SUPABASE_ANON_KEY', cloudflareEnv));
}

interface PgColumn {
  name: string;
  format: string;
  is_nullable: string;
  default_value: string | null;
}

interface PgTable {
  id: number;
  name: string;
  columns: PgColumn[];
}

/**
 * Fetches the current schema for a chat's app and returns a formatted markdown
 * string ready to be injected into the LLM system prompt.
 * Returns null when Supabase is not configured or the schema has no tables yet.
 */
export async function getSchemaContext(
  chatId: string,
  cloudflareEnv?: Record<string, unknown>
): Promise<string | null> {
  const supabaseUrl = getEnv('SUPABASE_URL', cloudflareEnv);
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY', cloudflareEnv);
  const anonKey = getEnv('SUPABASE_ANON_KEY', cloudflareEnv);

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  const schemaName = schemaForChat(chatId);
  const base = supabaseUrl.replace(/\/$/, '');

  try {
    const res = await fetch(`${base}/pg/tables?schema=${schemaName}`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });

    if (!res.ok) {
      return null;
    }

    const tables = (await res.json()) as PgTable[];

    if (!tables || tables.length === 0) {
      return null;
    }

    const lines: string[] = [
      '## App Database (Supabase / PostgREST)',
      '',
      `This app has a dedicated PostgreSQL schema: \`${schemaName}\``,
      '',
      '**Always initialise the Supabase client exactly like this:**',
      '```js',
      "import { createClient } from '@supabase/supabase-js';",
      'const cfg = window.__PROMPIFY_CONFIG || {};',
      `const supabase = createClient(`,
      `  cfg.supabaseUrl || '${supabaseUrl}',`,
      `  cfg.supabaseAnonKey || '${anonKey}',`,
      `  { db: { schema: cfg.supabaseSchema || '${schemaName}' } }`,
      `);`,
      '```',
      '',
      '**Existing tables:**',
    ];

    for (const table of tables) {
      lines.push(`\n### ${table.name}`);

      const cols = (table.columns || []).map(c => {
        const nullable = c.is_nullable === 'YES' ? ' (nullable)' : '';
        const def = c.default_value ? ` [default: ${c.default_value}]` : '';

        return `  - ${c.name}: ${c.format}${nullable}${def}`;
      });
      lines.push(...cols);
    }

    lines.push(
      '',
      '**Rules when generating database code:**',
      '- Install `@supabase/supabase-js` as a dependency',
      '- Add `<script src="/env-config.js"></script>` inside `<head>` of index.html BEFORE any other scripts',
      '- Use `supabase.from("table").select() / .insert() / .update() / .delete()` for all CRUD',
      '- Always destructure `{ data, error }` and handle the error case'
    );

    return lines.join('\n');
  } catch (err) {
    console.error('[supabase-provision] getSchemaContext error:', err);
    return null;
  }
}

/**
 * Runs an arbitrary SQL statement via the postgres-meta /pg/query endpoint.
 * Used for CREATE TABLE, ALTER TABLE, NOTIFY, etc.
 */
export async function runAdminQuery(
  sql: string,
  cloudflareEnv?: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const supabaseUrl = getEnv('SUPABASE_URL', cloudflareEnv);
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY', cloudflareEnv);

  if (!supabaseUrl || !serviceKey) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const base = supabaseUrl.replace(/\/$/, '');

  try {
    const res = await fetch(`${base}/pg/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: sql }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: body };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
