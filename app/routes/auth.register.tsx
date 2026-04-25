import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { useState } from 'react';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import { Card } from '~/components/ui/Card';
import BackgroundRays from '~/components/ui/BackgroundRays';

interface ActionData {
  error?: string;
  success?: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Check if user is already authenticated
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  
  if (token) {
    return redirect('/app/');
  }
  
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;
  const intent = formData.get('intent') as string;

  if (!email || !password || !confirmPassword) {
    return json<ActionData>({ error: 'All fields are required' });
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return json<ActionData>({ error: 'Please enter a valid email address' });
  }

  // Password strength validation
  if (password.length < 8) {
    return json<ActionData>({ error: 'Password must be at least 8 characters long' });
  }

  if (!/(?=.*[a-z])/.test(password)) {
    return json<ActionData>({ error: 'Password must contain at least one lowercase letter' });
  }

  if (!/(?=.*[A-Z])/.test(password)) {
    return json<ActionData>({ error: 'Password must contain at least one uppercase letter' });
  }

  if (!/(?=.*\d)/.test(password)) {
    return json<ActionData>({ error: 'Password must contain at least one number' });
  }

  if (!/(?=.*[!@#$%^&*])/.test(password)) {
    return json<ActionData>({ error: 'Password must contain at least one special character (!@#$%^&*)' });
  }

  // Password confirmation
  if (password !== confirmPassword) {
    return json<ActionData>({ error: 'Passwords do not match' });
  }

  try {
    if (intent === 'register') {
      // Call your registration API
      const url = new URL(request.url);
      const response = await fetch(`${url.origin}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        return json<ActionData>({ error: (data as any)?.message || 'Registration failed' });
      }

      return json<ActionData>({ 
        success: 'Registration successful! Please check your email to verify your account.' 
      });
    }
  } catch (error) {
    console.error('Registration error:', error);
    return json<ActionData>({ error: 'An unexpected error occurred' });
  }

  return json<ActionData>({ error: 'Invalid action' });
}

export default function RegisterPage() {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState({
    length: false,
    lowercase: false,
    uppercase: false,
    number: false,
    special: false,
  });
  const isSubmitting = navigation.state === 'submitting';

  const handlePasswordChange = (password: string) => {
    setPasswordStrength({
      length: password.length >= 8,
      lowercase: /(?=.*[a-z])/.test(password),
      uppercase: /(?=.*[A-Z])/.test(password),
      number: /(?=.*\d)/.test(password),
      special: /(?=.*[!@#$%^&*])/.test(password),
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-bolt-elements-textPrimary mb-2">
            Create Account
          </h1>
          <p className="text-bolt-elements-textSecondary">
            Join Prompify and start building amazing AI applications
          </p>
        </div>

        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="register" />
          
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
                placeholder="Create a strong password"
                className="w-full pr-10"
                onChange={(e) => handlePasswordChange(e.target.value)}
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
            
            {/* Password strength indicator */}
            <div className="mt-2 space-y-1">
              <div className={`flex items-center text-xs ${passwordStrength.length ? 'text-green-600' : 'text-gray-500'}`}>
                <div className={`w-1 h-1 rounded-full mr-2 ${passwordStrength.length ? 'bg-green-600' : 'bg-gray-400'}`} />
                At least 8 characters
              </div>
              <div className={`flex items-center text-xs ${passwordStrength.lowercase ? 'text-green-600' : 'text-gray-500'}`}>
                <div className={`w-1 h-1 rounded-full mr-2 ${passwordStrength.lowercase ? 'bg-green-600' : 'bg-gray-400'}`} />
                One lowercase letter
              </div>
              <div className={`flex items-center text-xs ${passwordStrength.uppercase ? 'text-green-600' : 'text-gray-500'}`}>
                <div className={`w-1 h-1 rounded-full mr-2 ${passwordStrength.uppercase ? 'bg-green-600' : 'bg-gray-400'}`} />
                One uppercase letter
              </div>
              <div className={`flex items-center text-xs ${passwordStrength.number ? 'text-green-600' : 'text-gray-500'}`}>
                <div className={`w-1 h-1 rounded-full mr-2 ${passwordStrength.number ? 'bg-green-600' : 'bg-gray-400'}`} />
                One number
              </div>
              <div className={`flex items-center text-xs ${passwordStrength.special ? 'text-green-600' : 'text-gray-500'}`}>
                <div className={`w-1 h-1 rounded-full mr-2 ${passwordStrength.special ? 'bg-green-600' : 'bg-gray-400'}`} />
                One special character (!@#$%^&*)
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-bolt-elements-textPrimary mb-2">
              Confirm Password
            </label>
            <div className="relative">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                required
                placeholder="Confirm your password"
                className="w-full pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
              >
                {showConfirmPassword ? (
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

          {actionData?.success && (
            <div className="p-3 rounded-md bg-green-50 border border-green-200 text-green-700 text-sm">
              {actionData.success}
            </div>
          )}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full"
          >
            {isSubmitting ? 'Creating Account...' : 'Create Account'}
          </Button>
        </Form>

        <div className="text-center">
          <p className="text-sm text-bolt-elements-textSecondary">
            Already have an account?{' '}
            <a href="/?login=1" className="text-blue-600 hover:text-blue-700 font-medium">
              Sign in
            </a>
          </p>
        </div>
      </Card>
    </div>
  );
} 