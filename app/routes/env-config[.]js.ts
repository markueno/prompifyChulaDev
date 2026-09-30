/**
 * GET /env-config.js — guaranteed fallback for `window.__PROMPIFY_CONFIG`.
 *
 * The primary path is `promptifyConfig.ts` writing env-config.js into the
 * WebContainer's FS (same-origin to the generated app). But that write races
 * the `server-ready` event on a page refresh (chatId not set yet), so the
 * file may not exist when the app loads. This Remix route is a guaranteed
 * fallback: the generated app can point its `<script src>` at the Prompify
 * origin instead of the WebContainer origin, so the config is always available
 * regardless of the FS write timing.
 *
 * CORS: the WebContainer preview origin (*.local-credentialless.webcontainer-api.io)
 * is reflected, matching the data proxy's CORS policy.
 *
 * Auth: requires a session (requireAuth). The chatId is derived from the
 * `chatId` query param OR the session's active chat (the token endpoint
 * already does this). A fresh data token is issued here so the config is
 * self-contained — no separate /api/data/token call needed.
 */
import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { requireAuth } from '~/lib/auth';
import { issueDataApiToken } from '~/lib/.server/data-token';
import { getChatById } from '~/lib/database';

const WEBCONTAINER_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.local-credentialless\.webcontainer-api\.io$/;

function getCtxEnv(context: LoaderFunctionArgs['context']): Record<string, unknown> {
  return (context?.cloudflare?.env as unknown as Record<string, unknown>) ?? {};
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireAuth(request, context);
  const env = getCtxEnv(context);

  const chatId = new URL(request.url).searchParams.get('chatId');

  if (!chatId) {
    return new Response('/* chatId required */', {
      status: 400,
      headers: { 'Content-Type': 'application/javascript' },
    });
  }

  /*
   * Confirm the caller can actually reach this chat before minting a credential for it. The
   * chatId arrives in the query string, and this endpoint previously issued a token for whatever
   * it was handed — the data proxy would still have refused the request, but an endpoint that
   * mints credentials on demand should check first rather than rely on the next one to catch it.
   */
  const chat = await getChatById(chatId, user.id, user.isModerator);

  if (!chat) {
    return new Response('/* not found */', {
      status: 404,
      headers: { 'Content-Type': 'application/javascript' },
    });
  }

  /*
   * Issue on the canonical chat.id, matching /api/data/token, so the token's scope and the id the
   * config hands the app are the same value.
   */
  const token = await issueDataApiToken(user.id, chat.id, env);

  const config = {
    apiUrl: `${new URL(request.url).origin}/api/data`,
    chatId: chat.id,
    token,
  };

  const body = `window.__PROMPIFY_CONFIG = ${JSON.stringify(config)};\n`;

  const origin = request.headers.get('Origin') || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };

  if (WEBCONTAINER_ORIGIN_RE.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    headers.Vary = 'Origin';
  }

  return new Response(body, { headers });
}
