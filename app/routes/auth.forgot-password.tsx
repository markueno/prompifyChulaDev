import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LinksFunction,
  type LoaderFunctionArgs,
  type MetaFunction,
} from '@remix-run/cloudflare';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { isAuthDisabled, optionalAuth } from '~/lib/auth';
import landingStyles from '~/styles/landing.css?url';

export const meta: MetaFunction = () => [
  { name: 'robots', content: 'noindex, nofollow' },
  { title: 'Forgot Password — Prompify' },
];

/* Must match auth.reset-password.tsx — the landing-* classes below come from this stylesheet. */
export const links: LinksFunction = () => [
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,100..900;1,100..900&display=swap',
  },
  { rel: 'stylesheet', href: landingStyles },
];

interface ActionData {
  error?: string;
  success?: string;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (isAuthDisabled(context)) {
    return redirect('/app/');
  }

  try {
    const user = await optionalAuth(request, context);

    if (user) {
      return redirect('/app/');
    }
  } catch {
    // not authenticated, show forgot-password page
  }

  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = (formData.get('email') as string)?.trim().toLowerCase() || '';

  if (!email) {
    return json<ActionData>({ error: 'Email is required' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    return json<ActionData>({ error: 'Please enter a valid email address' });
  }

  try {
    /*
     * Internal port, not the public origin — avoids the nginx/CF redirect that turns the
     * loopback POST into a GET (see auth.register.tsx / login fix d82d0c2).
     */
    const response = await fetch('http://localhost:5173/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();

    if (!response.ok) {
      return json<ActionData>({
        error: (data as { message?: string })?.message || 'Something went wrong. Please try again.',
      });
    }

    return json<ActionData>({
      success:
        (data as { message?: string })?.message ??
        "If an account exists with that email, we've sent a password reset link. Please check your inbox and spam folder.",
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return json<ActionData>({ error: 'An unexpected error occurred. Please try again.' });
  }
}

export default function ForgotPasswordPage() {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  /*
   * Same shell as auth.reset-password.tsx — the two are halves of one journey, and the reset page
   * (the one people actually land on from the email) already wears the site's own auth styling.
   * This page previously used the generic Card/BackgroundRays chrome with light-mode-only status
   * boxes, so the flow changed appearance halfway through.
   */
  return (
    <div className="landing-page min-h-screen">
      <div className="landing-hero-bg">
        <img src="/landing-pics/background1.jpeg" alt="" />
        <div className="gradient-overlay" />
        <div className="vignette" />
      </div>

      <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
        <div className="landing-login-modal-panel w-full max-w-md">
          <div className="landing-login-modal-header">
            <h2>Forgot your password?</h2>
            <p>Enter your email and we&apos;ll send you a link to reset it.</p>
          </div>

          {actionData?.success ? (
            <div className="landing-login-modal-form landing-login-modal-form--stack">
              <div className="landing-login-modal-success" role="status">
                {actionData.success}
              </div>
              <a href="/?login=1" className="landing-login-modal-submit">
                Back to Sign in
              </a>
              <a
                href="/auth/forgot-password"
                className="landing-login-modal-submit landing-login-modal-submit--secondary"
              >
                Send another link
              </a>
            </div>
          ) : (
            <Form method="post" className="landing-login-modal-form">
              {actionData?.error && (
                <div className="landing-login-modal-error" role="alert">
                  {actionData.error}
                </div>
              )}

              <label htmlFor="email" className="landing-login-modal-label">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                className="landing-login-modal-input"
              />

              <button type="submit" className="landing-login-modal-submit" disabled={isSubmitting}>
                {isSubmitting ? 'Sending…' : 'Send reset link'}
              </button>
            </Form>
          )}

          <div className="landing-login-modal-footer">
            <a href="/?login=1" className="landing-login-modal-footer-btn">
              Back to Sign in
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}

export function ErrorBoundary() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-gray-500">Please refresh the page and try again.</p>
      </div>
    </div>
  );
}
