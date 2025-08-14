import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getUserByVerificationToken, verifyUser } from '~/lib/database';

interface VerifyRequest {
  token: string;
}

interface VerifyResponse {
  success: boolean;
  message?: string;
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ success: false, message: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body: VerifyRequest = await request.json();
    const { token } = body;

    if (!token) {
      return json<VerifyResponse>({
        success: false,
        message: 'Verification token is required'
      }, { status: 400 });
    }

    // Find user by verification token
    const user = await getUserByVerificationToken(token) as {
      id: string;
      email: string;
      verified: number;
      verification_expires: string | null;
    } | undefined;
    
    if (!user) {
      return json<VerifyResponse>({
        success: false,
        message: 'Invalid verification token'
      }, { status: 400 });
    }

    // Check if token has expired
    if (user.verification_expires && new Date() > new Date(user.verification_expires)) {
      return json<VerifyResponse>({
        success: false,
        message: 'Verification token has expired. Please request a new one.'
      }, { status: 400 });
    }

    // Check if user is already verified
    if (user.verified === 1) {
      return json<VerifyResponse>({
        success: false,
        message: 'Email is already verified'
      }, { status: 400 });
    }

    // Update user to verified status
    const success = await verifyUser(user.id || '');
    
    if (!success) {
      return json<VerifyResponse>({
        success: false,
        message: 'Failed to verify email. Please try again.'
      }, { status: 500 });
    }

    return json<VerifyResponse>({
      success: true,
      message: 'Email verified successfully!'
    });

  } catch (error) {
    console.error('Verification error:', error);
    return json<VerifyResponse>({
      success: false,
      message: 'An unexpected error occurred'
    }, { status: 500 });
  }
}

// Database functions are now imported from ~/lib/database 