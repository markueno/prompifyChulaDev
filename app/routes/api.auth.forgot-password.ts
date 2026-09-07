import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createPasswordResetToken, logEmail, checkRateLimit, getUserStatus } from '~/lib/database';
import { sendPasswordResetEmail } from '~/lib/email';
import { canResetPassword, parseAccountStatus } from '~/lib/account-status';

interface ForgotPasswordRequest {
  email: string;
}

interface ForgotPasswordResponse {
  success: boolean;
  message: string;
}

/** Always return the same message for security (don't reveal if email exists). */
const SUCCESS_MESSAGE =
  "If an account exists with that email, we've sent a password reset link. Please check your inbox and spam folder.";

export async function action({ request, context: _context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json<ForgotPasswordResponse>({ success: false, message: 'Method not allowed' }, { status: 405 });
  }

  const clientIP =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';
  const rateResult = await checkRateLimit(clientIP, 'forgot-password', 5, 60);

  if (!rateResult.allowed) {
    return json<ForgotPasswordResponse>(
      { success: false, message: 'Too many requests. Please try again later.' },
      { status: 429 }
    );
  }

  try {
    const body: ForgotPasswordRequest = await request.json();
    const email = (body?.email ?? '').trim().toLowerCase();

    if (!email) {
      return json<ForgotPasswordResponse>({ success: false, message: 'Email is required' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return json<ForgotPasswordResponse>({ success: false, message: 'Invalid email format' }, { status: 400 });
    }

    const result = await createPasswordResetToken(email);

    if (result) {
      /*
       * A suspended account may not reset its password. The generic success message below is
       * returned either way — telling the sender their account is suspended would confirm the
       * address is registered, which is exactly what SUCCESS_MESSAGE exists to avoid.
       *
       * The token has already been minted at this point and is simply left unsent; it expires on
       * its own, and the next legitimate request overwrites it.
       */
      const status = parseAccountStatus(await getUserStatus(result.user.id));

      if (canResetPassword(status)) {
        const sent = await sendPasswordResetEmail(email, result.token);
        await logEmail(result.user.id, 'reset', sent);
      } else {
        await logEmail(result.user.id, 'reset', false, `Blocked: account is ${status}`);
      }
    }

    return json<ForgotPasswordResponse>({
      success: true,
      message: SUCCESS_MESSAGE,
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return json<ForgotPasswordResponse>(
      { success: false, message: 'Something went wrong. Please try again later.' },
      { status: 500 }
    );
  }
}
