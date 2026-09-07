import { json, redirect, type ActionFunctionArgs } from '@remix-run/cloudflare';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createAuthCookie, clearAuthCookie, getAuthToken, isEmailVerificationRequired } from '~/lib/auth';

interface LoginRequest {
  email: string;
  password: string;
}

interface LoginResponse {
  success: boolean;
  token?: string;
  user?: {
    id: string;
    email: string;
    isVerified: boolean;
    isModerator?: boolean;
  };
  message?: string;
}

// Rate limiting storage (in production, use Redis or database)
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();

const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;

async function handleLogin({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ success: false, message: 'Method not allowed' }, { status: 405 });
  }

  const contentType = request.headers.get('Content-Type') || '';
  const isFormSubmit =
    contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');

  let email: string;
  let password: string;

  if (isFormSubmit) {
    const formData = await request.formData();
    email = (formData.get('email') as string) || '';
    password = (formData.get('password') as string) || '';

    const intent = (formData.get('intent') as string) || '';

    if (intent !== 'login') {
      return redirect('/?login=1&error=' + encodeURIComponent('Invalid action'));
    }
  } else {
    const body: LoginRequest = await request.json();
    email = body.email;
    password = body.password;
  }

  try {
    const emailVerificationRequired = isEmailVerificationRequired(context);

    // Input validation
    if (!email || !password) {
      if (isFormSubmit) {
        return redirect('/?login=1&error=' + encodeURIComponent('Email and password are required'));
      }

      return json<LoginResponse>(
        {
          success: false,
          message: 'Email and password are required',
        },
        { status: 400 }
      );
    }

    // Email validation and normalize (case-insensitive)
    const emailNormalized = (email ?? '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(emailNormalized)) {
      if (isFormSubmit) {
        return redirect('/?login=1&error=' + encodeURIComponent('Invalid email format'));
      }

      return json<LoginResponse>(
        {
          success: false,
          message: 'Invalid email format',
        },
        { status: 400 }
      );
    }

    // Rate limiting check
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const attempts = loginAttempts.get(clientIP);

    if (attempts) {
      if (now - attempts.lastAttempt < RATE_LIMIT_WINDOW) {
        if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
          if (isFormSubmit) {
            return redirect(
              '/?login=1&error=' + encodeURIComponent('Too many login attempts. Please try again in 15 minutes.')
            );
          }

          return json<LoginResponse>(
            {
              success: false,
              message: 'Too many login attempts. Please try again in 15 minutes.',
            },
            { status: 429 }
          );
        }
      } else {
        // Reset counter if window has passed
        loginAttempts.delete(clientIP);
      }
    }

    // Update rate limiting
    const currentAttempts = loginAttempts.get(clientIP) || { count: 0, lastAttempt: now };
    currentAttempts.count += 1;
    currentAttempts.lastAttempt = now;
    loginAttempts.set(clientIP, currentAttempts);

    // Get user from database
    const user = (await getUserByEmail(emailNormalized)) as
      | {
          id: string;
          email: string;
          password_hash: string;
          is_verified: number;
          is_moderator?: boolean;
          is_superadmin?: boolean;
          login_attempts: number;
          deleted_at?: string | null;
        }
      | undefined;

    /*
     * A soft-deleted account must behave exactly like one that never existed — same message, same
     * status. Saying "this account was deleted" would confirm the address was once registered,
     * which is the enumeration leak the generic wording exists to avoid.
     */
    if (user?.deleted_at) {
      if (isFormSubmit) {
        return redirect('/?login=1&error=' + encodeURIComponent('Invalid email or password'));
      }

      return json<LoginResponse>({ success: false, message: 'Invalid email or password' }, { status: 401 });
    }

    if (!user) {
      // Update login attempts for non-existent user
      await updateLoginAttempts(emailNormalized, 1);

      if (isFormSubmit) {
        return redirect('/?login=1&error=' + encodeURIComponent('Invalid email or password'));
      }

      return json<LoginResponse>(
        {
          success: false,
          message: 'Invalid email or password',
        },
        { status: 401 }
      );
    }

    // Check if user is verified
    if (emailVerificationRequired && (!user.is_verified || user.is_verified === 0)) {
      if (isFormSubmit) {
        return redirect('/?login=1&error=' + encodeURIComponent('Please verify your email address before logging in'));
      }

      return json<LoginResponse>(
        {
          success: false,
          message: 'Please verify your email address before logging in',
        },
        { status: 401 }
      );
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash || '');

    if (!isValidPassword) {
      // Update login attempts
      await updateLoginAttempts(emailNormalized, (user.login_attempts || 0) + 1);

      if (isFormSubmit) {
        return redirect('/?login=1&error=' + encodeURIComponent('Invalid email or password'));
      }

      return json<LoginResponse>(
        {
          success: false,
          message: 'Invalid email or password',
        },
        { status: 401 }
      );
    }

    // Reset login attempts on successful login
    await resetLoginAttempts(user.id || '');

    /*
     * Self-healing: make sure the account has its personal workspace + Trial token pool.
     * Idempotent (won't refill a used-up trial) — covers accounts whose signup/verify grant failed.
     */
    await ensureUserTrial(user.id || '');

    // Generate JWT token
    const secret = (context.cloudflare?.env as any)?.JWT_SECRET ?? process.env.JWT_SECRET ?? '';
    const isModerator = Boolean(user.is_moderator);
    const token = jwt.sign(
      {
        userId: user.id || '',
        email: user.email || '',
        isVerified: (user.is_verified || 0) === 1,
        isModerator,
        isSuperadmin: Boolean(user.is_superadmin),
      },
      secret,
      { expiresIn: '24h' }
    );

    // Create session in database (this will invalidate any existing sessions)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
    const userAgent = request.headers.get('User-Agent') || '';

    await createUserSession(user.id || '', tokenHash, expiresAt, clientIP, userAgent);

    // Clear rate limiting on successful login
    loginAttempts.delete(clientIP);

    if (isFormSubmit) {
      const headers = new Headers();
      headers.append('Set-Cookie', createAuthCookie(token, request));

      return redirect('/app/', { headers });
    }

    return json<LoginResponse>({
      success: true,
      token,
      user: {
        id: user.id || '',
        email: user.email || '',
        isVerified: Boolean(user.is_verified),
        isModerator,
      },
    });
  } catch (error) {
    console.error('Login error:', error);

    if (isFormSubmit) {
      return redirect('/?login=1&error=' + encodeURIComponent('An unexpected error occurred'));
    }

    return json<LoginResponse>(
      {
        success: false,
        message: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

import {
  getUserByEmail,
  updateLoginAttempts,
  resetLoginAttempts,
  createUserSession,
  ensureUserTrial,
  logoutUser,
} from '~/lib/database';

/**
 * Every login attempt ends whatever session the browser already had.
 *
 * Submitting this form is an explicit statement of intent to become a particular account. If the
 * attempt fails and the previous session survives it, the visitor is silently left authenticated
 * as whoever they were before — and `_index.tsx` redirects any authenticated visitor straight to
 * `/app/`, so a failed sign-in lands them inside someone else's account with the error message
 * never shown. That is how signing in as a deleted account dropped the user into the admin app.
 *
 * Success paths always set an auth cookie, so the absence of one identifies a failure without
 * having to touch each of the dozen early returns.
 */
export async function action(args: ActionFunctionArgs) {
  const response = await handleLogin(args);

  if (response.headers.get('Set-Cookie')) {
    return response;
  }

  // Kill the old session server-side too; the cookie alone is only half of it.
  const existingToken = getAuthToken(args.request);

  if (existingToken) {
    try {
      const tokenHash = crypto.createHash('sha256').update(existingToken).digest('hex');
      await logoutUser(tokenHash);
    } catch {
      /* never let session cleanup turn a failed login into a 500 */
    }
  }

  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', clearAuthCookie(args.request));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
