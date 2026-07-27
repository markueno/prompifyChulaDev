import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getUserByEmail, createUser, logEmail, checkRateLimit } from '~/lib/database';
import { sendVerificationEmail } from '~/lib/email';
import { isEmailVerificationRequired } from '~/lib/auth';

interface RegisterRequest {
  email: string;
  password: string;
}

interface RegisterResponse {
  success: boolean;
  message?: string;
  verificationToken?: string;
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ success: false, message: 'Method not allowed' }, { status: 405 });
  }

  try {
    const emailVerificationRequired = isEmailVerificationRequired(context);
    const body: RegisterRequest = await request.json();
    const { email, password } = body;

    // Input validation
    if (!email || !password) {
      return json<RegisterResponse>(
        {
          success: false,
          message: 'Email and password are required',
        },
        { status: 400 }
      );
    }

    // Email validation and normalize (case-insensitive)
    const emailNormalized = (email ?? '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(emailNormalized)) {
      return json<RegisterResponse>(
        {
          success: false,
          message: 'Invalid email format',
        },
        { status: 400 }
      );
    }

    // Password strength validation
    if (password.length < 8) {
      return json<RegisterResponse>(
        {
          success: false,
          message: 'Password must be at least 8 characters long',
        },
        { status: 400 }
      );
    }

    // bcrypt silently ignores bytes past 72 (CWE-521)
    if (password.length > 72) {
      return json<RegisterResponse>(
        {
          success: false,
          message: 'Password must be at most 72 characters',
        },
        { status: 400 }
      );
    }

    if (!/(?=.*[a-z])/.test(password)) {
      return json<RegisterResponse>(
        {
          success: false,
          message: 'Password must contain at least one lowercase letter',
        },
        { status: 400 }
      );
    }

    if (!/(?=.*[A-Z])/.test(password)) {
      return json<RegisterResponse>(
        {
          success: false,
          message: 'Password must contain at least one uppercase letter',
        },
        { status: 400 }
      );
    }

    if (!/(?=.*\d)/.test(password)) {
      return json<RegisterResponse>(
        {
          success: false,
          message: 'Password must contain at least one number',
        },
        { status: 400 }
      );
    }

    if (!/(?=.*[!@#$%^&*])/.test(password)) {
      return json<RegisterResponse>(
        {
          success: false,
          message: 'Password must contain at least one special character (!@#$%^&*)',
        },
        { status: 400 }
      );
    }

    // Rate limiting check (database-backed, shared across instances)
    const clientIP =
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
      'unknown';
    const rateResult = await checkRateLimit(clientIP, 'register', 3, 3600);

    if (!rateResult.allowed) {
      return json<RegisterResponse>(
        {
          success: false,
          message: 'Too many registration attempts. Please try again in 1 hour.',
        },
        { status: 429 }
      );
    }

    // Check if user already exists
    const existingUser = await getUserByEmail(emailNormalized);

    if (existingUser) {
      // Return generic success to prevent email enumeration (OWASP recommendation)
      return json<RegisterResponse>({
        success: true,
        message: 'If this email is eligible, you will receive a verification link.',
      });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Generate verification token only when verification is required
    const verificationToken = emailVerificationRequired ? crypto.randomBytes(32).toString('hex') : null;
    const verificationExpires = emailVerificationRequired ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;

    // Create user in database
    const userId = crypto.randomUUID();
    const user = {
      id: userId,
      email: emailNormalized,
      passwordHash,
      isVerified: !emailVerificationRequired,
      verificationToken,
      verificationExpires: verificationExpires?.toISOString() || null,
      createdAt: new Date().toISOString(),
    };

    try {
      const success = await createUser(user);

      if (!success) {
        console.error('❌ createUser returned false');
        return json<RegisterResponse>(
          {
            success: false,
            message: 'Failed to create account. Please check database connection and try again.',
          },
          { status: 500 }
        );
      }
    } catch (error: any) {
      console.error('❌ Error during user creation:', error);

      // Check for specific database errors
      if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
        return json<RegisterResponse>({
          success: true,
          message: 'If this email is eligible, you will receive a verification link.',
        });
      }

      if (error.message?.includes('connection') || error.message?.includes('ECONNREFUSED')) {
        return json<RegisterResponse>(
          {
            success: false,
            message: 'Database connection failed. Please check your DATABASE_URL configuration.',
          },
          { status: 500 }
        );
      }

      return json<RegisterResponse>(
        {
          success: false,
          message: `Failed to create account: ${error.message || 'Unknown error'}`,
        },
        { status: 500 }
      );
    }

    if (emailVerificationRequired && verificationToken) {
      // Send verification email
      const emailSent = await sendVerificationEmail(emailNormalized, verificationToken);

      // Log email attempt
      await logEmail(userId, 'verification', emailSent, emailSent ? undefined : 'Email service not configured');
    }

    return json<RegisterResponse>({
      success: true,
      message: emailVerificationRequired
        ? 'Account created successfully. Please check your email to verify your account.'
        : 'Account created successfully. You can log in immediately.',
    });
  } catch (error) {
    console.error('Registration error:', error);
    return json<RegisterResponse>(
      {
        success: false,
        message: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

// Email service is now imported from ~/lib/email
