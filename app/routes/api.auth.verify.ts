import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getUserByVerificationToken, logEmail, verifyUser } from '~/lib/database';
import { sendWelcomeEmail } from '~/lib/email';

interface VerifyRequest {
  token: string;
}

interface VerifyResponse {
  success: boolean;
  message?: string;
}

/** Run verification logic; returns { success, message } or throws. */
async function verifyToken(token: string): Promise<{ success: boolean; message: string }> {
  const user = (await getUserByVerificationToken(token)) as
    | {
        id: string;
        email?: string;
        verification_expires: string | null;
        is_verified?: number | boolean;
      }
    | undefined;

  if (!user) {
    return { success: false, message: 'Invalid verification token' };
  }

  if (user.verification_expires && new Date() > new Date(user.verification_expires)) {
    return { success: false, message: 'Verification token has expired. Please request a new one.' };
  }

  if (user.is_verified === 1 || user.is_verified === true) {
    return { success: false, message: 'Email is already verified' };
  }

  const success = await verifyUser(user.id || '');

  if (!success) {
    return { success: false, message: 'Failed to verify email. Please try again.' };
  }

  /*
   * Welcome the account now that the address is confirmed. Sent from here rather than from the
   * loader/action so both the emailed link (GET) and the form post (POST) are covered exactly
   * once — the `is_verified` guard above turns a re-clicked link into an early return, so a
   * second welcome never goes out.
   *
   * A failed send must not fail verification: the account IS verified at this point, and
   * returning an error would strand the user on a "verification failed" page for a working
   * account. The email_logs row records the miss instead.
   */
  if (user.email) {
    try {
      const sent = await sendWelcomeEmail(user.email);
      await logEmail(user.id, 'welcome', sent, sent ? undefined : 'Email service not configured or send failed');
    } catch (error) {
      console.error('Welcome email failed after verification:', error);
      await logEmail(user.id, 'welcome', false, error instanceof Error ? error.message : 'Unknown error').catch(
        () => undefined
      );
    }
  }

  return { success: true, message: 'Email verified successfully!' };
}

/** Handle GET /api/auth/verify?token=... (e.g. link clicked in email or prefetch). */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return redirect('/auth/verify?error=missing');
  }

  try {
    const result = await verifyToken(token);

    if (result.success) {
      return redirect('/?login=1&verified=1');
    }

    return redirect(`/auth/verify?error=${encodeURIComponent(result.message)}`);
  } catch (error) {
    console.error('Verification error (GET):', error);
    return redirect('/auth/verify?error=unexpected');
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json<VerifyResponse>({ success: false, message: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body: VerifyRequest = await request.json();
    const token = body?.token?.trim();

    if (!token) {
      return json<VerifyResponse>(
        {
          success: false,
          message: 'Verification token is required',
        },
        { status: 400 }
      );
    }

    const result = await verifyToken(token);

    if (result.success) {
      return json<VerifyResponse>({ success: true, message: result.message });
    }

    return json<VerifyResponse>({ success: false, message: result.message }, { status: 400 });
  } catch (error) {
    console.error('Verification error (POST):', error);
    return json<VerifyResponse>(
      {
        success: false,
        message: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

// Database functions are now imported from ~/lib/database
