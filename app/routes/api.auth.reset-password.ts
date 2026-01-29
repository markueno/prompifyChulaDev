import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import bcrypt from 'bcryptjs';
import { getUserByResetToken, setPasswordFromResetToken } from '~/lib/database';

interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

interface ResetPasswordResponse {
  success: boolean;
  message?: string;
}

const saltRounds = 10;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json<ResetPasswordResponse>({ success: false, message: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body: ResetPasswordRequest = await request.json();
    const { token, newPassword } = body;

    if (!token) {
      return json<ResetPasswordResponse>(
        { success: false, message: 'Reset token is required' },
        { status: 400 }
      );
    }

    if (!newPassword || newPassword.length < 8) {
      return json<ResetPasswordResponse>(
        { success: false, message: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    if (!/(?=.*[a-z])/.test(newPassword)) {
      return json<ResetPasswordResponse>(
        { success: false, message: 'Password must contain at least one lowercase letter' },
        { status: 400 }
      );
    }
    if (!/(?=.*[A-Z])/.test(newPassword)) {
      return json<ResetPasswordResponse>(
        { success: false, message: 'Password must contain at least one uppercase letter' },
        { status: 400 }
      );
    }
    if (!/(?=.*\d)/.test(newPassword)) {
      return json<ResetPasswordResponse>(
        { success: false, message: 'Password must contain at least one number' },
        { status: 400 }
      );
    }
    if (!/(?=.*[!@#$%^&*])/.test(newPassword)) {
      return json<ResetPasswordResponse>(
        { success: false, message: 'Password must contain at least one special character (!@#$%^&*)' },
        { status: 400 }
      );
    }

    const user = await getUserByResetToken(token);
    if (!user) {
      return json<ResetPasswordResponse>(
        { success: false, message: 'Invalid or expired reset link. Please request a new one.' },
        { status: 400 }
      );
    }

    const expires = user.reset_expires ? new Date(user.reset_expires) : null;
    if (expires && new Date() > expires) {
      return json<ResetPasswordResponse>(
        { success: false, message: 'This reset link has expired. Please request a new one.' },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, saltRounds);
    const updated = await setPasswordFromResetToken(token, passwordHash);

    if (!updated) {
      return json<ResetPasswordResponse>(
        { success: false, message: 'Failed to update password. The link may have expired.' },
        { status: 400 }
      );
    }

    return json<ResetPasswordResponse>({
      success: true,
      message: 'Your password has been reset. You can now sign in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return json<ResetPasswordResponse>(
      { success: false, message: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
