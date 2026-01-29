import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createPasswordResetToken, logEmail } from '~/lib/database';
import { sendPasswordResetEmail } from '~/lib/email';

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

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json<ForgotPasswordResponse>({ success: false, message: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body: ForgotPasswordRequest = await request.json();
    const email = (body?.email ?? '').trim().toLowerCase();

    if (!email) {
      return json<ForgotPasswordResponse>(
        { success: false, message: 'Email is required' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return json<ForgotPasswordResponse>(
        { success: false, message: 'Invalid email format' },
        { status: 400 }
      );
    }

    const result = await createPasswordResetToken(email);

    if (result) {
      const sent = await sendPasswordResetEmail(email, result.token);
      await logEmail(result.user.id, 'reset', sent);
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
