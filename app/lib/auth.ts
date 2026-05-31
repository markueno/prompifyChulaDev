import { json, redirect } from '@remix-run/cloudflare';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { validateSession, updateSessionActivity } from './database';

export interface User {
  id: string;
  email: string;
  isVerified: boolean;
  isModerator?: boolean;
  /** Account tier: Trial, Builder, Innovator. Blank if not found. */
  accountTier?: string | null;
}

function readEnvValue(context: any, key: string): string | undefined {
  const cloudflareEnv = context?.cloudflare?.env || {};
  const processEnv = process.env || {};

  return cloudflareEnv[key] || processEnv[key];
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'true' || normalized === '1') {
    return true;
  }

  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return defaultValue;
}

// Check if authentication is temporarily disabled
export function isAuthDisabled(context: any): boolean {
  const cloudflareEnv = context?.cloudflare?.env || {};
  const processEnv = process.env || {};
  const authDisabled = cloudflareEnv.AUTH_DISABLED || processEnv.AUTH_DISABLED || processEnv.VITE_AUTH_DISABLED;

  return authDisabled === 'true' || authDisabled === '1';
}

/**
 * Controls whether newly-registered users must verify email before login.
 * Set EMAIL_VERIFICATION_REQUIRED=false (or 0) to disable verification.
 */
export function isEmailVerificationRequired(context: any): boolean {
  const value = readEnvValue(context, 'EMAIL_VERIFICATION_REQUIRED');
  return parseBooleanEnv(value, true);
}

/*
 * Get a mock admin user when authentication is disabled
 * Full access to Settings and Control Panel (no account type or moderator checks)
 */
export function getMockAdminUser(): User {
  return {
    id: 'admin-bypass',
    email: 'admin@bypass.local',
    isVerified: true,
    isModerator: true,
  };
}

export async function requireAuth(request: Request, context: any): Promise<User> {
  if (isAuthDisabled(context)) {
    return getMockAdminUser();
  }

  const token = getAuthToken(request);

  if (!token) {
    throw redirect('/?login=1');
  }

  let decoded: any;

  try {
    const secret = (context.cloudflare?.env as any)?.JWT_SECRET || 'your-secret-key';
    decoded = jwt.verify(token, secret);
  } catch {
    throw redirect('/?login=1');
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = await validateSession(tokenHash);

  if (!session) {
    throw redirect('/?login=1&message=session_expired');
  }

  // fire-and-forget — last_used update doesn't need to block the response
  updateSessionActivity(tokenHash).catch(() => {});

  return {
    id: decoded.userId,
    email: decoded.email,
    isVerified: decoded.isVerified,
    isModerator: Boolean(decoded.isModerator),
  };
}

export function getAuthToken(request: Request): string | null {
  // Check Authorization header first
  const authHeader = request.headers.get('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check cookies
  const cookieHeader = request.headers.get('Cookie');

  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce(
      (acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        acc[key] = value;

        return acc;
      },
      {} as Record<string, string>
    );

    return cookies.auth_token || null;
  }

  return null;
}

export async function optionalAuth(request: Request, context: any): Promise<User | null> {
  try {
    return await requireAuth(request, context);
  } catch (error) {
    return null;
  }
}

// Session conflict detection
export async function checkSessionConflict(userId: string): Promise<boolean> {
  /*
   * This can be used to show a warning if user tries to login from multiple places
   * For now, we just invalidate old sessions automatically
   */
  return false;
}

/**
 * Creates an authentication cookie string with proper Secure flag handling
 * Only uses Secure flag in production (HTTPS), not in development (HTTP)
 */
export function createAuthCookie(token: string, request?: Request): string {
  // Check if we're in a secure context (HTTPS or production)
  let isSecure = false;

  if (request) {
    const url = new URL(request.url);
    isSecure = url.protocol === 'https:';
  }

  // Also check NODE_ENV as fallback
  if (!isSecure) {
    isSecure = process.env.NODE_ENV === 'production';
  }

  const secureFlag = isSecure ? 'Secure;' : '';

  return `auth_token=${token}; HttpOnly; ${secureFlag} SameSite=Strict; Path=/; Max-Age=86400`;
}

/**
 * Creates a cookie clearing string with proper Secure flag handling
 */
export function clearAuthCookie(request?: Request): string {
  let isSecure = false;

  if (request) {
    const url = new URL(request.url);
    isSecure = url.protocol === 'https:';
  }

  if (!isSecure) {
    isSecure = process.env.NODE_ENV === 'production';
  }

  const secureFlag = isSecure ? 'Secure;' : '';

  return `auth_token=; Path=/; HttpOnly; ${secureFlag} SameSite=Strict; Max-Age=0`;
}
