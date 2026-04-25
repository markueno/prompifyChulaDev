import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, useActionData, useNavigation, useSearchParams } from '@remix-run/react';
import { useState } from 'react';
import { Button } from '~/components/ui/Button';
import { Card } from '~/components/ui/Card';
import { Input } from '~/components/ui/Input';
import { Label } from '~/components/ui/Label';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { isAuthDisabled, optionalAuth, createAuthCookie } from '~/lib/auth';

interface ActionData {
  error?: string;
  success?: string;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  // If authentication is disabled, redirect to app builder
  if (isAuthDisabled(context)) {
    console.log('🚫 Authentication disabled - redirecting from login to app');
    return redirect('/app');
  }

  // Check if user is already authenticated
  try {
    const user = await optionalAuth(request, context);
    if (user) {
      console.log('✅ User already authenticated, redirecting to app');
      return redirect('/app');
    }
  } catch (error) {
    // User is not authenticated, continue to login page
    console.log('ℹ️ User not authenticated, showing login page');
  }

  // Retire standalone login page: open login modal on homepage instead.
  const url = new URL(request.url);
  const destination = new URL('/', url.origin);
  url.searchParams.forEach((value, key) => {
    destination.searchParams.set(key, value);
  });
  destination.searchParams.set('login', '1');

  return redirect(`${destination.pathname}?${destination.searchParams.toString()}`);
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const intent = formData.get('intent') as string;

  if (!email || !password) {
    return json<ActionData>({ error: 'Email and password are required' });
  }

  try {
    if (intent === 'login') {
      // Call your authentication API
      const url = new URL(request.url);
      const response = await fetch(`${url.origin}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        return json<ActionData>({ error: (data as any)?.message || 'Login failed' });
      }

      // Set authentication cookie/token using helper function
      const headers = new Headers();
      headers.append('Set-Cookie', createAuthCookie((data as any)?.token, request));

      return redirect('/app', { headers });
    }
  } catch (error) {
    console.error('Login error:', error);
    return json<ActionData>({ error: 'An unexpected error occurred' });
  }

  return json<ActionData>({ error: 'Invalid action' });
}

export default function LoginPage() {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const [showPassword, setShowPassword] = useState(false);
  const isSubmitting = navigation.state === 'submitting';
  
  // Check for session conflict message using Remix's useSearchParams
  const [searchParams] = useSearchParams();
  const sessionMessage = searchParams.get('message');

  return (
    <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-bolt-elements-textPrimary mb-2">
            Welcome Back
          </h1>
          <p className="text-bolt-elements-textSecondary">
            Sign in to your Prompify account
          </p>
        </div>

        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="login" />
          
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-bolt-elements-textPrimary mb-2">
              Email Address
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              placeholder="Enter your email"
              className="w-full"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-bolt-elements-textPrimary mb-2">
              Password
            </label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="Enter your password"
                className="w-full pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
              >
                {showPassword ? (
                  <div className="i-ph:eye-slash text-lg" />
                ) : (
                  <div className="i-ph:eye text-lg" />
                )}
              </button>
            </div>
          </div>

          {actionData?.error && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
              {actionData.error}
            </div>
          )}

          {sessionMessage === 'session_expired' && (
            <div className="p-3 rounded-md bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm">
              Your session has expired because you logged in from another device. Please sign in again.
            </div>
          )}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full"
          >
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </Button>
        </Form>

        <div className="text-center">
          <p className="text-sm text-bolt-elements-textSecondary">
            Don't have an account?{' '}
            <a href="/auth/register" className="text-blue-600 hover:text-blue-700 font-medium">
              Sign up
            </a>
          </p>
        </div>

        <div className="text-center">
          <a href="/auth/forgot-password" className="text-sm text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary">
            Forgot your password?
          </a>
        </div>
      </Card>
    </div>
  );
} 