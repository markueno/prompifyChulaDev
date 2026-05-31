import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { isSupabaseConfigured, schemaForChat } from '~/lib/supabase-provision.server';

/**
 * GET /api/supabase/config?chatId=<id>
 *
 * Returns the Supabase connection details for the browser (Admin → Data section).
 * The service_role_key is intentionally never sent to the browser.
 * If Supabase is not configured on this server, returns { configured: false }
 * and the Data section falls back to the manual connect form.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const cloudflareEnv = (context?.cloudflare?.env as unknown as Record<string, unknown>) ?? {};

  if (!isSupabaseConfigured(cloudflareEnv)) {
    return json({ configured: false });
  }

  const supabaseUrl = (cloudflareEnv.SUPABASE_URL as string) || process.env.SUPABASE_URL || '';
  const anonKey = (cloudflareEnv.SUPABASE_ANON_KEY as string) || process.env.SUPABASE_ANON_KEY || '';

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId') ?? '';
  const schema = chatId ? schemaForChat(chatId) : 'public';

  return json({
    configured: true,
    url: supabaseUrl,
    anonKey,
    schema,
  });
}
