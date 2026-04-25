import { json, redirect, type ActionFunctionArgs, type LinksFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { useState } from 'react';
import { isAuthDisabled, optionalAuth } from '~/lib/auth';
import landingStyles from '~/styles/landing.css?url';

interface LoaderData {
  token: string | null;
  error?: string;
}

interface ActionData {
  error?: string;
  success?: boolean;
}

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap' },
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,100..900;1,100..900&display=swap' },
  { rel: 'stylesheet', href: landingStyles },
];

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
      <div className="landing-page min-h-screen">
        <div className="landing-hero-bg">
          <img src="/landing-pics/background1.jpeg" alt="Background" />
          <div className="gradient-overlay" />
          <div className="vignette" />
        </div>

        <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
          <div className="landing-login-modal-panel w-full max-w-md">
            <div className="landing-login-modal-header">
              <h2>Invalid link</h2>
              <p>{loaderData.error}</p>
            </div>
            <div className="landing-login-modal-form landing-login-modal-form--stack">
              <a href="/auth/forgot-password" className="landing-login-modal-submit">
                Request new reset link
              </a>
              <a href="/?login=1" className="landing-login-modal-submit landing-login-modal-submit--secondary">
                Back to Sign In
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (actionData?.success) {
    return (
      <div className="landing-page min-h-screen">
        <div className="landing-hero-bg">
          <img src="/landing-pics/background1.jpeg" alt="Background" />
          <div className="gradient-overlay" />
          <div className="vignette" />
        </div>

        <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
          <div className="landing-login-modal-panel w-full max-w-md">
            <div className="text-center mb-4">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
                <span className="i-ph:check-circle text-3xl text-green-600" />
              </div>
            </div>
            <div className="landing-login-modal-header">
              <h2>Password reset</h2>
              <p>Your password has been updated. You can now sign in with your new password.</p>
            </div>
            <div className="landing-login-modal-form">
              <a href="/?login=1" className="landing-login-modal-submit">
                Sign In
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="landing-page min-h-screen">
      <div className="landing-hero-bg">
        <img src="/landing-pics/background1.jpeg" alt="Background" />
        <div className="gradient-overlay" />
        <div className="vignette" />
      </div>

      <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
        <div className="landing-login-modal-panel w-full max-w-md">
          <div className="landing-login-modal-header">
            <h2>Set new password</h2>
            <p>
              Enter your new password below. Use at least 8 characters with uppercase, lowercase, a number, and a special
              character.
            </p>
          </div>

          <Form method="post" className="landing-login-modal-form">
            <label htmlFor="newPassword" className="landing-login-modal-label">
              New password
            </label>
            <div className="landing-login-modal-password-wrap">
              <input
                id="newPassword"
                name="newPassword"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                placeholder="Enter new password"
                className="landing-login-modal-input"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="landing-login-modal-toggle-pw"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>

            <label htmlFor="confirmPassword" className="landing-login-modal-label">
              Confirm password
            </label>
            <div className="landing-login-modal-password-wrap">
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirm ? 'text' : 'password'}
                required
                autoComplete="new-password"
                placeholder="Confirm new password"
                className="landing-login-modal-input"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="landing-login-modal-toggle-pw"
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
              >
                {showConfirm ? 'Hide' : 'Show'}
              </button>
            </div>

            {actionData?.error && (
              <div className="landing-login-modal-error" role="alert">
                {actionData.error}
              </div>
            )}

            <button type="submit" disabled={isSubmitting} className="landing-login-modal-submit">
              {isSubmitting ? 'Updating...' : 'Update password'}
            </button>
          </Form>

          <div className="landing-login-modal-footer">
            <a href="/?login=1">Back to Sign In</a>
          </div>
        </div>
      </main>
    </div>
  );
}
