/**
 * POST /api/data/:chatId/:resource/generate — LLM-generated sample rows for
 * an existing empty table.
 *
 * Loads the table's columns from the app_tables registry, asks the LLM for
 * ~12 realistic, domain-appropriate rows, validates the returned rows against
 * the column whitelist, and inserts them via the seed endpoint.
 *
 * Auth: same as the resource route (bearer token OR session cookie). Owner-only.
 *
 * Used by the "Generate sample data" button in AdminDataSection — the retroactive
 * seeding path for existing tables that the AI didn't seed at generation time.
 */
import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth, type User } from '~/lib/auth';
import { getChatById } from '~/lib/database';
import { getRegisteredTable, runAppQuery } from '~/lib/data-provision.server';
import { validateDataApiToken } from '~/lib/.server/data-token';
import { getPostgresPool } from '~/lib/database-postgresql';

const MAX_GENERATED_ROWS = 12;

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

/**
 * Build a tight system prompt that asks the LLM for JSON rows matching the
 * table's column schema. The LLM has no access to the app's business logic —
 * it infers realistic values from column names + types alone, which is sufficient
 * for sample data (e.g. a "email" text column gets "user@example.com", a "salary"
 * numeric column gets a plausible number).
 */
function buildGeneratePrompt(tableName: string, columns: Array<{ name: string; type: string }>): string {
  const colSpec = columns.map(c => `${c.name} (${c.type})`).join(', ');
  const keys = columns.map(c => `"${c.name}"`).join(', ');

  return `Generate ${MAX_GENERATED_ROWS} realistic sample data rows for a database table named "${tableName}".
The table has these columns: ${colSpec}.
Exclude the columns: id, created_at, updated_at (they are auto-managed).

Return ONLY a JSON array of objects. Each object must have exactly these keys: ${keys}.
Make the data realistic, varied, and domain-appropriate for the table name.
Do not include any explanation — just the JSON array.

Example format:
[{"${columns[0]?.name || 'field'}": "value1", "${columns[1]?.name || 'field2'}": "value2"}, ...]`;
}

/**
 * Parse the LLM's text response into a JSON array. The LLM may wrap the JSON
 * in markdown fences or add prose — extract the array robustly.
 */
function parseRowsFromLLM(text: string): Record<string, unknown>[] {
  // Strip markdown code fences if present.
  let cleaned = text.trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }

  // Find the first '[' and the last ']' — the LLM may add prose around the array.
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');

  if (start === -1 || end === -1) {
    return [];
  }

  const jsonStr = cleaned.slice(start, end + 1);

  try {
    const parsed = JSON.parse(jsonStr);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function action(args: ActionFunctionArgs) {
  const user = await resolveUser(args.request, args.context);

  if (!user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { chatId, resource } = args.params;

  if (!chatId || !resource) {
    return json({ error: 'Bad route' }, { status: 400 });
  }

  // Resolve the chat + table (same ownership gate as the resource route).
  const chat = await getChatById(chatId, user.id, user.isModerator);

  if (!chat) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  if (chat.user_id !== user.id && !user.isModerator) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const table = await getRegisteredTable(chat.id, resource);

  if (!table) {
    return json({ error: 'Table not found' }, { status: 404 });
  }

  if (table.schema_name !== `usr_${chat.user_id.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`) {
    return json({ error: 'Schema mismatch' }, { status: 500 });
  }

  // Check the table is empty — don't overwrite existing data.
  const countResult = await runAppQuery(chat.user_id, `SELECT COUNT(*)::int AS c FROM "${table.table_name}"`);

  if (!countResult.ok) {
    return json({ error: countResult.error || 'Failed to check table' }, { status: 500 });
  }

  const existingCount = Number(countResult.rows?.[0]?.c ?? 0);

  if (existingCount > 0) {
    return json({ error: 'Table already has data — clear it first before generating sample rows' }, { status: 409 });
  }

  const columns = (table.columns || []).filter(
    (c: { name: string }) => !['id', 'created_at', 'updated_at'].includes(c.name)
  );

  if (columns.length === 0) {
    return json({ error: 'No user-defined columns to generate data for' }, { status: 400 });
  }

  /*
   * Call the LLM via the same /api/llmcall route that the template selector uses.
   * This reuses the LLMManager's provider resolution (Qwen, Anthropic, etc.) instead
   * of trying raw API keys that may not be configured on prod.
   */
  const prompt = buildGeneratePrompt(table.logical_name, columns);
  const origin = new URL(args.request.url).origin;

  let llmResponse: string | null = null;

  try {
    const llmRes = await fetch(`${origin}/api/llmcall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: prompt,
        system:
          'You are a helpful assistant that generates realistic sample data for database tables. Always respond with valid JSON only.',
      }),
    });

    if (llmRes.ok) {
      const data = (await llmRes.json()) as { text?: string };
      llmResponse = data.text ?? null;
    }
  } catch {
    // fall through to the error below
  }

  if (!llmResponse) {
    return json({ error: 'LLM call failed — check that an AI provider is configured' }, { status: 500 });
  }

  const rows = parseRowsFromLLM(llmResponse);

  if (rows.length === 0) {
    return json({ error: 'LLM returned no valid rows' }, { status: 500 });
  }

  // Validate + filter each row against the column whitelist.
  const colSet = new Set(columns.map(c => c.name));
  const validRows = rows
    .map(row => {
      const filtered: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(row)) {
        if (colSet.has(key)) {
          filtered[key] = value;
        }
      }

      return filtered;
    })
    .filter(row => Object.keys(row).length > 0);

  if (validRows.length === 0) {
    return json({ error: 'No valid rows after filtering against column whitelist' }, { status: 500 });
  }

  /*
   * Insert via the same per-row INSERT the resource route uses (reliable, no
   * separate seed call needed — this is a small batch, ≤12 rows).
   */
  const pool = getPostgresPool();
  const client = await pool.connect();
  let inserted = 0;

  try {
    await client.query('BEGIN');

    for (const row of validRows) {
      const entries = Object.entries(row);
      const colNames = entries.map(([k]) => `"${k}"`);
      const placeholders = entries.map((_, i) => `$${i + 1}`);
      const values = entries.map(([, v]) => v);
      const sql = `INSERT INTO "${table.schema_name}"."${table.table_name}" (${colNames.join(', ')}) VALUES (${placeholders.join(', ')})`;

      await client.query(sql, values);
      inserted++;
    }

    await client.query('COMMIT');

    // Bump the registry row_count.
    await client.query(`UPDATE app_tables SET row_count = $1 WHERE schema_name = $2 AND table_name = $3`, [
      inserted,
      table.schema_name,
      table.table_name,
    ]);
  } catch (err) {
    await client.query('ROLLBACK');
    return json({ error: err instanceof Error ? err.message : 'Insert failed' }, { status: 500 });
  } finally {
    client.release();
  }

  return json({ inserted });
}
