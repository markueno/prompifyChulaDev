import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/Button';
import { Card } from '~/components/ui/Card';
import { Input } from '~/components/ui/Input';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { isAuthDisabled, optionalAuth } from '~/lib/auth';

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
    const url = new URL(request.url);
    const response = await fetch(`${url.origin}/api/auth/forgot-password`, {
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1">
      <BackgroundRays />

      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-bolt-elements-textPrimary mb-2">Forgot your password?</h1>
          <p className="text-bolt-elements-textSecondary">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
        </div>

        {actionData?.success ? (
          <div className="space-y-4">
            <div className="p-3 rounded-md bg-green-50 border border-green-200 text-green-700 text-sm">
              {actionData.success}
            </div>
            <div className="flex flex-col gap-2">
              <Button _asChild className="w-full">
                <a href="/?login=1">Back to Sign In</a>
              </Button>
              <Button variant="outline" _asChild className="w-full">
                <a href="/auth/forgot-password">Send another link</a>
              </Button>
            </div>
          </div>
        ) : (
          <Form method="post" className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-bolt-elements-textPrimary mb-2">
                Email Address
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="Enter your email"
                className="w-full"
              />
            </div>

            {actionData?.error && (
              <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
                {actionData.error}
              </div>
            )}

            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? 'Sending...' : 'Send reset link'}
            </Button>
          </Form>
        )}

        <div className="text-center">
          <a href="/?login=1" className="text-sm text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary">
            Back to Sign In
          </a>
        </div>
      </Card>
    </div>
  );
}
