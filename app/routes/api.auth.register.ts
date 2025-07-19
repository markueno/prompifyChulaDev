import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getUserByEmail, createUser, logEmail } from '~/lib/database';
import { sendVerificationEmail } from '~/lib/email';

interface RegisterRequest {
  email: string;
  password: string;
}

interface RegisterResponse {
  success: boolean;
  message?: string;
  verificationToken?: string;
}

// Rate limiting storage (in production, use Redis or database)
const registrationAttempts = new Map<string, { count: number; lastAttempt: number }>();

const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_REGISTRATION_ATTEMPTS = 3;

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ success: false, message: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body: RegisterRequest = await request.json();
    const { email, password } = body;

    // Input validation
    if (!email || !password) {
      return json<RegisterResponse>({
        success: false,
        message: 'Email and password are required'
      }, { status: 400 });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return json<RegisterResponse>({
        success: false,
        message: 'Invalid email format'
      }, { status: 400 });
    }

    // Password strength validation
    if (password.length < 8) {
      return json<RegisterResponse>({
        success: false,
        message: 'Password must be at least 8 characters long'
      }, { status: 400 });
    }

    if (!/(?=.*[a-z])/.test(password)) {
      return json<RegisterResponse>({
        success: false,
        message: 'Password must contain at least one lowercase letter'
      }, { status: 400 });
    }

    if (!/(?=.*[A-Z])/.test(password)) {
      return json<RegisterResponse>({
        success: false,
        message: 'Password must contain at least one uppercase letter'
      }, { status: 400 });
    }

    if (!/(?=.*\d)/.test(password)) {
      return json<RegisterResponse>({
        success: false,
        message: 'Password must contain at least one number'
      }, { status: 400 });
    }

    if (!/(?=.*[!@#$%^&*])/.test(password)) {
      return json<RegisterResponse>({
        success: false,
        message: 'Password must contain at least one special character (!@#$%^&*)'
      }, { status: 400 });
    }

    // Rate limiting check
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const attempts = registrationAttempts.get(clientIP);

    if (attempts) {
      if (now - attempts.lastAttempt < RATE_LIMIT_WINDOW) {
        if (attempts.count >= MAX_REGISTRATION_ATTEMPTS) {
          return json<RegisterResponse>({
            success: false,
            message: 'Too many registration attempts. Please try again in 1 hour.'
          }, { status: 429 });
        }
      } else {
        // Reset counter if window has passed
        registrationAttempts.delete(clientIP);
      }
    }

    // Update rate limiting
    const currentAttempts = registrationAttempts.get(clientIP) || { count: 0, lastAttempt: now };
    currentAttempts.count += 1;
    currentAttempts.lastAttempt = now;
    registrationAttempts.set(clientIP, currentAttempts);

    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return json<RegisterResponse>({
        success: false,
        message: 'An account with this email already exists'
      }, { status: 409 });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create user in database
    const userId = crypto.randomUUID();
    const user = {
      id: userId,
      email: email.toLowerCase(),
      passwordHash,
      verified: false,
      verificationToken,
      verificationExpires: verificationExpires.toISOString(),
      createdAt: new Date().toISOString()
    };

    const success = await createUser(user);
    
    if (!success) {
      return json<RegisterResponse>({
        success: false,
        message: 'Failed to create account. Please try again.'
      }, { status: 500 });
    }

    // Send verification email
    const emailSent = await sendVerificationEmail(email, verificationToken);
    
    // Log email attempt
    await logEmail(userId, 'verification', emailSent, emailSent ? undefined : 'Email service not configured');

    // Clear rate limiting on successful registration
    registrationAttempts.delete(clientIP);

    return json<RegisterResponse>({
      success: true,
      message: 'Account created successfully. Please check your email to verify your account.'
    });

  } catch (error) {
    console.error('Registration error:', error);
    return json<RegisterResponse>({
      success: false,
      message: 'An unexpected error occurred'
    }, { status: 500 });
  }
}

// Email service is now imported from ~/lib/email 