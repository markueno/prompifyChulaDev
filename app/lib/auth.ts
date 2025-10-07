import { json, redirect } from '@remix-run/cloudflare';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { validateSession, updateSessionActivity } from './database';

export interface User {
  id: string;
  email: string;
  isVerified: boolean;
}

// Check if authentication is temporarily disabled
export function isAuthDisabled(context: any): boolean {
  // Check multiple sources for the environment variable
  const cloudflareEnv = context?.cloudflare?.env || {};
  const processEnv = process.env || {};
  
  // Try to get AUTH_DISABLED from multiple sources
  const authDisabled = 
    cloudflareEnv.AUTH_DISABLED || 
    processEnv.AUTH_DISABLED || 
    processEnv.VITE_AUTH_DISABLED;
  
  // For development, also check if we're in development mode and allow bypass
  const isDevelopment = processEnv.NODE_ENV === 'development';
  const isDisabled = authDisabled === 'true' || authDisabled === '1';
  
  // Debug logging
  console.log('🔍 Auth bypass check:', {
    contextKeys: context ? Object.keys(context) : 'no context',
    cloudflareEnvKeys: Object.keys(cloudflareEnv).filter(k => k.includes('AUTH')),
    processEnvKeys: Object.keys(processEnv).filter(k => k.includes('AUTH')),
    cloudflareEnv_AUTH_DISABLED: cloudflareEnv.AUTH_DISABLED,
    processEnv_AUTH_DISABLED: processEnv.AUTH_DISABLED,
    processEnv_VITE_AUTH_DISABLED: processEnv.VITE_AUTH_DISABLED,
    NODE_ENV: processEnv.NODE_ENV,
    isDevelopment,
    finalAuthDisabled: authDisabled,
    isDisabled
  });
  
  return isDisabled;
}

// Get a mock admin user when authentication is disabled
export function getMockAdminUser(): User {
  return {
    id: 'admin-bypass',
    email: 'admin@bypass.local',
    isVerified: true,
  };
}

export async function requireAuth(request: Request, context: any): Promise<User> {
  console.log('🔐 requireAuth called with:', {
    url: request.url,
    method: request.method,
    hasAuthHeader: !!request.headers.get('Authorization'),
    hasCookie: !!request.headers.get('Cookie'),
    contextKeys: context ? Object.keys(context) : 'no context'
  });

  // Check if authentication is disabled
  if (isAuthDisabled(context)) {
    console.warn('⚠️ AUTHENTICATION COMPLETELY BYPASSED: AUTH_DISABLED is set to true');
    const mockUser = getMockAdminUser();
    console.log('✅ Returning mock admin user:', mockUser);
    return mockUser;
  }

  // If authentication is enabled, proceed with normal auth flow
  console.log('🔒 Authentication required - checking token...');
  const token = getAuthToken(request);
  
  if (!token) {
    console.log('❌ No auth token found - redirecting to login');
    throw redirect('/auth/login');
  }

  console.log('🔑 Token found, verifying...');
  try {
    // Verify JWT token
    const secret = (context.cloudflare?.env as any)?.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, secret) as any;
    
    console.log('✅ JWT verified, checking session...');
    
    // Validate session in database
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = await validateSession(tokenHash);
    
    if (!session) {
      console.log('❌ Session not found or expired - redirecting to login');
      // Session not found or expired - user logged in elsewhere
      throw redirect('/auth/login?message=session_expired');
    }
    
    console.log('✅ Session valid, updating activity...');
    
    // Update session activity
    await updateSessionActivity(tokenHash);
    
    const user = {
      id: decoded.userId,
      email: decoded.email,
      isVerified: decoded.isVerified
    };
    
    console.log('✅ Authentication successful, returning user:', user);
    return user;
  } catch (error) {
    console.error('❌ Auth error:', error);
    throw redirect('/auth/login');
  }
}

export function getAuthToken(request: Request): string | null {
  // Check Authorization header first
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Check cookies
  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);
    
    return cookies.auth_token || null;
  }
  
  return null;
}

export async function optionalAuth(request: Request, context: any): Promise<User | null> {
  try {
    return await requireAuth(request, context);
  } catch (error) {
    return null;
  }
}

// Session conflict detection
export async function checkSessionConflict(userId: string): Promise<boolean> {
  // This can be used to show a warning if user tries to login from multiple places
  // For now, we just invalidate old sessions automatically
  return false;
}

export function clearAuthCookie(): string {
  return 'auth_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
} 