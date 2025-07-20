import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { logoutUser } from '~/lib/database';
import { getAuthToken } from '~/lib/auth';
import crypto from 'crypto';

interface LogoutResponse {
  success: boolean;
  message?: string;
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ success: false, message: 'Method not allowed' }, { status: 405 });
  }

  try {
    const token = getAuthToken(request);
    
    if (token) {
      // Invalidate session in database
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await logoutUser(tokenHash);
    }

    // Clear cookie
    const headers = new Headers();
    headers.append('Set-Cookie', 'auth_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');

    return json<LogoutResponse>({
      success: true,
      message: 'Logged out successfully'
    }, { headers });

  } catch (error) {
    console.error('Logout error:', error);
    return json<LogoutResponse>({
      success: false,
      message: 'An unexpected error occurred'
    }, { status: 500 });
  }
} 