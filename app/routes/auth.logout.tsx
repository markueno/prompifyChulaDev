import { redirect, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { clearAuthCookie } from '~/lib/auth';

export async function action({ request }: ActionFunctionArgs) {
  const headers = new Headers();
  headers.append('Set-Cookie', clearAuthCookie());

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