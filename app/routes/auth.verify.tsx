import { json, redirect, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { Button } from '~/components/ui/Button';
import { Card } from '~/components/ui/Card';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { isAuthDisabled } from '~/lib/auth';

interface LoaderData {
  success: boolean;
  message: string;
  token?: string;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  // If authentication is disabled, redirect to main page
  if (isAuthDisabled(context)) {
    console.log('🚫 Authentication disabled - redirecting from verify to main page');
    return redirect('/app');
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const errorFromQuery = url.searchParams.get('error');

  // Show error message when redirected from GET /api/auth/verify?token=... with error
  if (errorFromQuery) {
    const message = errorFromQuery === 'missing' || errorFromQuery === 'unexpected'
      ? (errorFromQuery === 'missing' ? 'Invalid verification link. Please check your email and try again.' : 'An unexpected error occurred during verification.')
      : decodeURIComponent(errorFromQuery);
    return json<LoaderData>({ success: false, message });
  }

  if (!token) {
    return json<LoaderData>({
      success: false,
      message: 'Invalid verification link. Please check your email and try again.'
    });
  }

  try {
    // Call your verification API
    const url = new URL(request.url);
    const response = await fetch(`${url.origin}/api/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });

    const data = await response.json();

    if (!response.ok) {
      return json<LoaderData>({
        success: false,
        message: (data as any)?.message || 'Verification failed. Please try again.'
      });
    }

    return json<LoaderData>({
      success: true,
      message: 'Email verified successfully! You can now sign in to your account.',
      token
    });

  } catch (error) {
    console.error('Verification error:', error);
    return json<LoaderData>({
      success: false,
      message: 'An unexpected error occurred during verification.'
    });
  }
}

export default function VerifyPage() {
  const loaderData = useLoaderData<LoaderData>();
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    if (loaderData.success) {
      // Redirect to login after 3 seconds
      const timer = setTimeout(() => {
        setIsRedirecting(true);
        window.location.href = '/auth/login';
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [loaderData.success]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="text-center">
          {loaderData.success ? (
            <>
              <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                <div className="i-ph:check-circle text-3xl text-green-600" />
              </div>
              <h1 className="text-3xl font-bold text-bolt-elements-textPrimary mb-2">
                Email Verified!
              </h1>
              <p className="text-bolt-elements-textSecondary">
                {loaderData.message}
              </p>
              {isRedirecting && (
                <p className="text-sm text-bolt-elements-textTertiary mt-2">
                  Redirecting to login...
                </p>
              )}
            </>
          ) : (
            <>
              <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
                <div className="i-ph:x-circle text-3xl text-red-600" />
              </div>
              <h1 className="text-3xl font-bold text-bolt-elements-textPrimary mb-2">
                Verification Failed
              </h1>
              <p className="text-bolt-elements-textSecondary">
                {loaderData.message}
              </p>
            </>
          )}
        </div>

        <div className="space-y-3">
          {loaderData.success ? (
            <Button
              onClick={() => window.location.href = '/auth/login'}
              className="w-full"
            >
              Sign In Now
            </Button>
          ) : (
            <>
              <Button
                onClick={() => window.location.href = '/auth/register'}
                className="w-full"
              >
                Create New Account
              </Button>
              <Button
                onClick={() => window.location.href = '/auth/login'}
                variant="outline"
                className="w-full"
              >
                Back to Sign In
              </Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
} 