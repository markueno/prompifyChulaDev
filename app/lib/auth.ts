import { json, redirect } from '@remix-run/cloudflare';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { validateSession, updateSessionActivity } from './database';

export interface User {
  id: string;
  email: string;
  verified: boolean;
}

export async function requireAuth(request: Request, context: any): Promise<User> {
  const token = getAuthToken(request);
  
  if (!token) {
    throw redirect('/auth/login');
  }

  try {
    // Verify JWT token
    const secret = (context.cloudflare?.env as any)?.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, secret) as any;
    
    // Validate session in database
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = await validateSession(tokenHash);
    
    if (!session) {
      // Session not found or expired - user logged in elsewhere
      throw redirect('/auth/login?message=session_expired');
    }
    
    // Update session activity
    await updateSessionActivity(tokenHash);
    
    return {
      id: decoded.userId,
      email: decoded.email,
      verified: decoded.verified
    };
  } catch (error) {
    console.error('Auth error:', error);
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