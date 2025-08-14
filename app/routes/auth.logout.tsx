import { redirect, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { isAuthDisabled } from '~/lib/auth';

export async function loader({ request, context }: LoaderFunctionArgs) {
  // If authentication is disabled, redirect to main page instead of logout
  if (isAuthDisabled(context)) {
    console.log('🚫 Authentication disabled - redirecting from logout to main page');
    return redirect('/');
  }

  // Clear authentication cookies and redirect to login
  const headers = new Headers();
  headers.append('Set-Cookie', 'auth_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
  
  return redirect('/auth/login', { headers });
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