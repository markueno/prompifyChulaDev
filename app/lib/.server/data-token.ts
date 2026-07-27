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
 * Phase-v1 note: when DATA_API_SECRET is unset we fall back to JWT_SECRET so the
 * staging environment works without a new env var; the security hardening pass
 * must set a dedicated DATA_API_SECRET in production.
 */
import jwt from 'jsonwebtoken';

const DATA_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const ISSUER = 'prompify:data-proxy';

function getSecret(context?: Record<string, unknown>): string {
  const cf = context as Record<string, unknown> | undefined;
  const fromEnv = (cf?.DATA_API_SECRET as string) || process.env.DATA_API_SECRET || process.env.JWT_SECRET || '';

  if (!fromEnv) {
    throw new Error('DATA_API_SECRET (or JWT_SECRET fallback) is required for data tokens');
  }

  return fromEnv;
}

export interface DataTokenClaims {
  userId: string;
  chatId: string;
  role: 'data_proxy';
}

/**
 * Issue a short-lived data token scoped to (userId, chatId). Called by
 * `POST /api/data/token` after validating the session JWT.
 */
export function issueDataApiToken(userId: string, chatId: string, context?: Record<string, unknown>): string {
  const secret = getSecret(context);

  return jwt.sign(
    {
      userId,
      chatId,
      role: 'data_proxy',
    },
    secret,
    { expiresIn: DATA_TOKEN_TTL_SECONDS, issuer: ISSUER }
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
