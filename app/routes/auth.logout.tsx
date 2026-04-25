import { redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { isAuthDisabled, clearAuthCookie } from '~/lib/auth';
import { logoutUser } from '~/lib/database';
import { getAuthToken } from '~/lib/auth';
import crypto from 'crypto';

export async function loader({ request, context }: LoaderFunctionArgs) {
  // If authentication is disabled, redirect to main page instead of logout
  if (isAuthDisabled(context)) {
    console.log('🚫 Authentication disabled - redirecting from logout to main page');
    return redirect('/');
  }

  // Clear authentication cookies and redirect to login
  const headers = new Headers();
  headers.append('Set-Cookie', clearAuthCookie(request));
  return redirect('/?login=1', { status: 303, headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  // If authentication is disabled, redirect to main page instead of logout
  if (isAuthDisabled(context)) {
    console.log('🚫 Authentication disabled - redirecting from logout to main page');
    return redirect('/');
  }

  try {
    const token = getAuthToken(request);
    
    if (token) {
      // Invalidate session in database
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await logoutUser(tokenHash);
    }

    // Clear cookie and redirect to login (303 = GET after POST)
    const headers = new Headers();
    headers.append('Set-Cookie', clearAuthCookie(request));
    return redirect('/?login=1', { status: 303, headers });
  } catch (error) {
    console.error('Logout error:', error);
    const headers = new Headers();
    headers.append('Set-Cookie', clearAuthCookie(request));
    return redirect('/?login=1', { status: 303, headers });
  }
}

export default function LogoutPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-bolt-elements-textPrimary mb-4">
          Logging out...
        </h1>
        <p className="text-bolt-elements-textSecondary">
          You will be redirected to the login page.
        </p>
      </div>
    </div>
  );
} 