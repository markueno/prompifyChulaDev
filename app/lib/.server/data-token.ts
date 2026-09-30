/**
 * Short-lived data API tokens for generated apps (separate from the session JWT).
 *
 * Session JWT  -> signed with JWT_SECRET, 24h, for platform access (auth/chat).
 * Data token   -> signed with DATA_API_SECRET, 15min, scoped to a single chatId.
 *
 * The data proxy (`api.data.$chatId.$resource.ts`) accepts EITHER a valid
 * session (same-origin, in-IDE preview) OR a bearer data token (cross-origin,
 * deployed apps). Never reuse JWT_SECRET for data access — a leak would
 * compromise both contexts (OWASP).
 *
 * The JWT_SECRET fallback survives for local development only. In production an unset
 * DATA_API_SECRET now throws rather than silently signing data tokens with the session secret:
 * sharing one key across both contexts means a single leak compromises platform sessions AND every
 * generated app's data, which is the exact outcome the separation exists to prevent. A
 * misconfiguration that weakens a boundary should be loud, not quiet.
 */
import jwt from 'jsonwebtoken';

const DATA_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const ISSUER = 'prompify:data-proxy';

function getSecret(context?: Record<string, unknown>): string {
  const cf = context as Record<string, unknown> | undefined;
  const dedicated = (cf?.DATA_API_SECRET as string) || process.env.DATA_API_SECRET || '';

  if (dedicated) {
    return dedicated;
  }

  /*
   * No dedicated secret. Acceptable locally, never in production — see the note above.
   */
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DATA_API_SECRET must be set in production. Data tokens must not share JWT_SECRET: one leak ' +
        'would compromise both platform sessions and the data of every generated app. ' +
        'Generate one with: openssl rand -hex 32'
    );
  }

  const fallback = process.env.JWT_SECRET || '';

  if (!fallback) {
    throw new Error('DATA_API_SECRET (or JWT_SECRET in development) is required for data tokens');
  }

  return fallback;
}

export interface DataTokenClaims {
  userId: string;
  chatId: string;
  role: 'data_proxy';
}

/**
 * Issue a data token scoped to (userId, chatId). Called by `POST /api/data/token`
 * after validating the session JWT, and by the deploy route when injecting
 * env-config.js into a deployed app.
 *
 * The default TTL is 15 minutes (for in-IDE preview token refresh). For shared
 * deploys, pass '7d' to issue a 7-day token so the shared URL stays functional.
 */
export function issueDataApiToken(
  userId: string,
  chatId: string,
  context?: Record<string, unknown>,
  ttl?: string
): string {
  const secret = getSecret(context);

  return jwt.sign(
    {
      userId,
      chatId,
      role: 'data_proxy',
    },
    secret,
    { expiresIn: (ttl ?? DATA_TOKEN_TTL_SECONDS) as any, issuer: ISSUER }
  );
}

/**
 * Validate a bearer data token. Returns the claims on success, null otherwise.
 * Never throws — callers treat null as 401.
 */
export function validateDataApiToken(token: string, context?: Record<string, unknown>): DataTokenClaims | null {
  try {
    const secret = getSecret(context);
    const decoded = jwt.verify(token, secret, { issuer: ISSUER }) as Record<string, unknown>;

    if (decoded.role !== 'data_proxy' || !decoded.userId || !decoded.chatId) {
      return null;
    }

    return {
      userId: decoded.userId as string,
      chatId: decoded.chatId as string,
      role: 'data_proxy',
    };
  } catch {
    return null;
  }
}
