import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import bcrypt from 'bcryptjs';
import { requireAuth } from '~/lib/auth';
import { getUserByEmail, updateUserPassword, logUserActivity } from '~/lib/database';

/*
 * Change the signed-in user's password.
 *
 * Distinct from /api/auth/reset-password, which is authorised by a token from an email. This one
 * is authorised by an active session AND the current password. Requiring the current password is
 * the point: without it, anyone who walks up to an unlocked laptop can lock the owner out of their
 * own account, and a stolen session cookie becomes permanent ownership.
 */

interface ChangePasswordRequest {
  currentPassword?: string;
  newPassword?: string;
}

interface ChangePasswordResponse {
  success: boolean;
  message?: string;
}

const SALT_ROUNDS = 12;

/** Mirrors the policy enforced by api.auth.reset-password so both routes agree. */
function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters long';
  }

  if (password.length > 72) {
    return 'Password must be at most 72 characters';
  }

  if (!/(?=.*[a-z])/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }

  if (!/(?=.*[A-Z])/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }

  if (!/(?=.*\d)/.test(password)) {
    return 'Password must contain at least one number';
  }

  if (!/(?=.*[!@#$%^&*])/.test(password)) {
    return 'Password must contain at least one special character (!@#$%^&*)';
  }

  return null;
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json<ChangePasswordResponse>({ success: false, message: 'Method not allowed' }, { status: 405 });
  }

  const user = await requireAuth(request, context);

  if (!user?.id || !user.email) {
    return json<ChangePasswordResponse>({ success: false, message: 'You must be signed in.' }, { status: 401 });
  }

  let body: ChangePasswordRequest;

  try {
    body = (await request.json()) as ChangePasswordRequest;
  } catch {
    return json<ChangePasswordResponse>({ success: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const currentPassword = body.currentPassword ?? '';
  const newPassword = body.newPassword ?? '';

  if (!currentPassword || !newPassword) {
    return json<ChangePasswordResponse>(
      { success: false, message: 'Both your current and new password are required.' },
      { status: 400 }
    );
  }

  const policyError = validatePassword(newPassword);

  if (policyError) {
    return json<ChangePasswordResponse>({ success: false, message: policyError }, { status: 400 });
  }

  if (currentPassword === newPassword) {
    return json<ChangePasswordResponse>(
      { success: false, message: 'Your new password must be different from your current one.' },
      { status: 400 }
    );
  }

  try {
    const record = (await getUserByEmail(user.email)) as { id?: string; password_hash?: string } | null;

    if (!record?.password_hash) {
      return json<ChangePasswordResponse>({ success: false, message: 'Account not found.' }, { status: 404 });
    }

    const matches = await bcrypt.compare(currentPassword, record.password_hash);

    if (!matches) {
      /*
       * Deliberately specific. The usual reason to blur a credential error is to avoid confirming
       * an account exists — but the session already proves who this is, so vagueness here would
       * only make a signed-in person guess at their own typo.
       */
      return json<ChangePasswordResponse>(
        { success: false, message: 'That is not your current password.' },
        { status: 403 }
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const updated = await updateUserPassword(user.id, passwordHash);

    if (!updated) {
      return json<ChangePasswordResponse>(
        { success: false, message: 'Could not update your password. Please try again.' },
        { status: 500 }
      );
    }

    /*
     * Other sessions are deliberately NOT invalidated. Signing every device out of an account is
     * what you do when a password is *suspected stolen* (the reset-by-email flow), not when
     * someone routinely rotates it from inside a session they already control.
     */
    await logUserActivity(user.id, 'password_changed', {}).catch(() => undefined);

    return json<ChangePasswordResponse>({ success: true, message: 'Your password has been updated.' });
  } catch (error) {
    console.error('Change password error:', error);
    return json<ChangePasswordResponse>(
      { success: false, message: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
