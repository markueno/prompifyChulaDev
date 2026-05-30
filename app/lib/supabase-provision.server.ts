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

export async function provisionAppSchema(
  chatId: string,
  cloudflareEnv?: Record<string, unknown>,
): Promise<void> {
  const supabaseUrl = getEnv('SUPABASE_URL', cloudflareEnv);
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY', cloudflareEnv);

  if (!supabaseUrl || !serviceKey) return;

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
