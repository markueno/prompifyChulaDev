import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { useState } from 'react';
import { Button } from '~/components/ui/Button';
import { Card } from '~/components/ui/Card';
import { Input } from '~/components/ui/Input';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { isAuthDisabled, optionalAuth } from '~/lib/auth';

interface LoaderData {
  token: string | null;
  error?: string;
}

interface ActionData {
  error?: string;
  success?: boolean;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (isAuthDisabled(context)) {
    return redirect('/app');
  }
  try {
    const user = await optionalAuth(request, context);
    if (user) return redirect('/app');
  } catch {
    // not authenticated
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return json<LoaderData>({
      token: null,
      error: 'Invalid or missing reset link. Please request a new password reset.',
    });
  }

  return json<LoaderData>({ token });
}

export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return json<ActionData>({ error: 'Invalid or missing reset link. Please request a new password reset.' });
  }

  const formData = await request.formData();
  const newPassword = (formData.get('newPassword') as string) || '';
  const confirmPassword = (formData.get('confirmPassword') as string) || '';

  if (!newPassword || newPassword.length < 8) {
    return json<ActionData>({ error: 'Password must be at least 8 characters long.' });
  }

  if (!/(?=.*[a-z])/.test(newPassword)) {
    return json<ActionData>({ error: 'Password must contain at least one lowercase letter.' });
  }
  if (!/(?=.*[A-Z])/.test(newPassword)) {
    return json<ActionData>({ error: 'Password must contain at least one uppercase letter.' });
  }
  if (!/(?=.*\d)/.test(newPassword)) {
    return json<ActionData>({ error: 'Password must contain at least one number.' });
  }
  if (!/(?=.*[!@#$%^&*])/.test(newPassword)) {
    return json<ActionData>({ error: 'Password must contain at least one special character (!@#$%^&*).' });
  }

  if (newPassword !== confirmPassword) {
    return json<ActionData>({ error: 'Passwords do not match.' });
  }

  try {
    const response = await fetch(`${url.origin}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    });

    const data = await response.json();

    if (!response.ok) {
      return json<ActionData>({
        error: (data as { message?: string })?.message || 'Failed to reset password. The link may have expired.',
      });
    }

    return json<ActionData>({ success: true });
  } catch (error) {
    console.error('Reset password error:', error);
    return json<ActionData>({ error: 'An unexpected error occurred. Please try again.' });
  }
}

export default function ResetPasswordPage() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const isSubmitting = navigation.state === 'submitting';

  if (!loaderData.token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1">
        <BackgroundRays />
        <Card className="w-full max-w-md p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-bolt-elements-textPrimary mb-2">Invalid link</h1>
            <p className="text-bolt-elements-textSecondary mb-4">{loaderData.error}</p>
            <Button asChild className="w-full">
              <a href="/auth/forgot-password">Request new reset link</a>
            </Button>
            <Button variant="outline" asChild className="w-full mt-2">
              <a href="/auth/login">Back to Sign In</a>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (actionData?.success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1">
        <BackgroundRays />
        <Card className="w-full max-w-md p-8 space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
              <span className="i-ph:check-circle text-3xl text-green-600" />
            </div>
            <h1 className="text-3xl font-bold text-bolt-elements-textPrimary mb-2">Password reset</h1>
            <p className="text-bolt-elements-textSecondary mb-4">
              Your password has been updated. You can now sign in with your new password.
            </p>
            <Button asChild className="w-full">
              <a href="/auth/login">Sign In</a>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1">
      <BackgroundRays />

      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-bolt-elements-textPrimary mb-2">Set new password</h1>
          <p className="text-bolt-elements-textSecondary">
            Enter your new password below. Use at least 8 characters with uppercase, lowercase, a number, and a special character.
          </p>
        </div>

        <Form method="post" className="space-y-4">
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-bolt-elements-textPrimary mb-2">
              New password
            </label>
            <div className="relative">
              <Input
                id="newPassword"
                name="newPassword"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                placeholder="Enter new password"
                className="w-full pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <span className={showPassword ? 'i-ph:eye-slash text-lg' : 'i-ph:eye text-lg'} aria-hidden />
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-bolt-elements-textPrimary mb-2">
              Confirm password
            </label>
            <div className="relative">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirm ? 'text' : 'password'}
                required
                autoComplete="new-password"
                placeholder="Confirm new password"
                className="w-full pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
              >
                <span className={showConfirm ? 'i-ph:eye-slash text-lg' : 'i-ph:eye text-lg'} aria-hidden />
              </button>
            </div>
          </div>

          {actionData?.error && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
              {actionData.error}
            </div>
          )}

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Updating...' : 'Update password'}
          </Button>
        </Form>

        <div className="text-center">
          <a href="/auth/login" className="text-sm text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary">
            Back to Sign In
          </a>
        </div>
      </Card>
    </div>
  );
}
