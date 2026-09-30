/**
 * Authentication for the data proxy, in one place.
 *
 * This logic used to exist as three identical copies of a `resolveUser` function, one in each of
 * the `/api/data/:chatId/:resource` routes. All three shared the same flaw — they validated the
 * bearer token and then threw away its `chatId` claim — and the triplication is why a single
 * oversight became three vulnerabilities. There is one copy now.
 *
 * Two ways in, with deliberately different scope:
 *
 *   session cookie  unscoped; the in-IDE case, already bounded by getChatById's access check
 *   bearer token    scoped to ONE chat, and that scope is now enforced
 *
 * The scope matters because a shared deploy embeds a 7-day token in `env-config.js`, which is
 * public in the deployed app. Without the check, anyone given a shared app link could read and
 * write the data of every project its owner could reach.
 */
import { requireAuth, type User } from '~/lib/auth';
import { getUserStatus } from '~/lib/database';
import { canPrompt, parseAccountStatus } from '~/lib/account-status';
import { validateDataApiToken } from '~/lib/.server/data-token';

export interface DataApiPrincipal {
  user: User;
  /** The chat this bearer token is scoped to, or null for session auth, which is unscoped. */
  tokenChatId: string | null;
}

export type RemixContext = { cloudflare?: { env?: unknown } } | undefined;

/** The Cloudflare-style env bag off the Remix context, or an empty object. */
export function getCtxEnv(context: RemixContext): Record<string, unknown> {
  return (context?.cloudflare?.env as Record<string, unknown>) ?? {};
}

export async function resolveDataApiPrincipal(
  request: Request,
  context: RemixContext
): Promise<DataApiPrincipal | null> {
  const auth = request.headers.get('Authorization') || '';

  if (auth.startsWith('Bearer ')) {
    const claims = validateDataApiToken(auth.slice(7), getCtxEnv(context));

    if (!claims) {
      return null;
    }

    /*
     * A data token is valid for up to seven days and carries no session behind it, so nothing else
     * would notice the account being suspended or deleted in the meantime. Checked here rather
     * than trusted from the token, which was minted before any of that happened.
     */
    if (!canPrompt(parseAccountStatus(await getUserStatus(claims.userId)))) {
      return null;
    }

    return {
      user: { id: claims.userId, email: '', isVerified: true, isModerator: false },
      tokenChatId: claims.chatId,
    };
  }

  try {
    return { user: await requireAuth(request, context), tokenChatId: null };
  } catch {
    // requireAuth throws a redirect Response for a page loader; for an API it just means "no".
    return null;
  }
}

/**
 * Whether a principal may act on this chat.
 *
 * Compares against both `id` and `url_id` because the two token issuers disagree about which they
 * use: `/api/data/token` issues on the canonical `chat.id`, while `env-config.js` issues on
 * whatever the query string carried, which may be a `url_id`. Both are legitimate, so accepting
 * either avoids breaking working deploys while still refusing a token minted for a different chat.
 */
export function tokenScopeAllows(tokenChatId: string | null, chat: { id: string; url_id?: string | null }): boolean {
  // Session auth carries no scope; getChatById has already decided what it may reach.
  if (tokenChatId === null) {
    return true;
  }

  return tokenChatId === chat.id || (!!chat.url_id && tokenChatId === chat.url_id);
}
